/**
 * /v1/auth — JWT minting for SDK clients.
 *
 * Single route today (POST /token). Mounting:
 *   app.route("/v1/auth", authRouter);
 *
 * Per the brief, this is INTENTIONALLY unauthenticated — clients exchange
 * `appSecret + userId` for a short-lived JWT here, then send that JWT on every
 * downstream call. The `requireAuth` middleware (auth/middleware.ts) is wired
 * onto `/v1/events` and onward in TASK-008.
 */
import { Hono } from "hono";
import { sign } from "../auth/jwt";
import { ensureUser } from "../db/schema";

const auth = new Hono<{ Bindings: Env }>();

/**
 * Validates the request body shape without pulling in zod (the rest of the
 * codebase is zod-free; one schema isn't worth a 14 KB dep). Returns the
 * narrowed shape on success or a string error code on failure.
 *
 * `kind` is optional and ONLY accepts the literal "demo" today. Any other
 * value silently drops to undefined — the demo mint proxy is the only
 * legitimate caller, so a stricter allowlist would just mean a bigger
 * surface area to confuse with no security benefit.
 */
interface MintBody {
  appId: string;
  appSecret: string;
  userId: string;
  kind?: "demo";
}

function parseMintBody(raw: unknown): MintBody | "validation_error" {
  if (typeof raw !== "object" || raw === null) return "validation_error";
  const obj = raw as Record<string, unknown>;
  const appId = obj.appId;
  const appSecret = obj.appSecret;
  const userId = obj.userId;
  const kindRaw = obj.kind;
  if (
    typeof appId !== "string" ||
    appId.length === 0 ||
    typeof appSecret !== "string" ||
    appSecret.length === 0 ||
    typeof userId !== "string" ||
    userId.length === 0
  ) {
    return "validation_error";
  }
  const body: MintBody = { appId, appSecret, userId };
  // Whitelist `kind: "demo"`. Any other string is silently ignored — we don't
  // 400 because a forward-compatible client might pass a future kind and we
  // don't want to break it; we just don't grant the privilege.
  if (kindRaw === "demo") body.kind = "demo";
  return body;
}

/**
 * Constant-time string compare via Web Crypto HMAC-verify.
 *
 * Approach: HMAC both inputs under a fresh random key, then `crypto.subtle.verify`
 * the resulting tags (spec-guaranteed timing-safe). This is the standard
 * Workers pattern — `crypto.subtle.timingSafeEqual` doesn't exist in workerd,
 * and a hand-rolled XOR-accumulator loop would also be fine but harder to
 * convince a reviewer is correct.
 *
 * Returns true iff `a === b` byte-for-byte; returns false on length mismatch
 * before any HMAC compute (length-leak is acceptable since it doesn't reveal
 * any secret content).
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;

  // Fresh random one-shot key so the HMAC tags can't be precomputed off-line.
  const keyMaterial = new Uint8Array(32);
  crypto.getRandomValues(keyMaterial);
  const key = await crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const aTag = await crypto.subtle.sign("HMAC", key, aBytes);
  // verify is timing-safe by spec — exactly what we want for the comparison.
  return crypto.subtle.verify("HMAC", key, aTag, bBytes);
}

function randomJti(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

auth.post("/token", async (c) => {
  // Step 1 — parse + validate body. Hono's c.req.json() throws on invalid
  // JSON; catch and convert to a 400.
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "validation_error" }, 400);
  }
  const parsed = parseMintBody(raw);
  if (parsed === "validation_error") {
    return c.json({ error: "validation_error" }, 400);
  }
  const { appSecret, userId, kind } = parsed;

  // Step 2 — timing-safe compare against APP_SECRET. We deliberately do NOT
  // differentiate "wrong appId" from "wrong secret" — both surface as
  // `invalid_credentials` to prevent app-id enumeration (per plan §5
  // CORS / auth row).
  const ok = await timingSafeEqual(appSecret, c.env.APP_SECRET);
  if (!ok) return c.json({ error: "invalid_credentials" }, 401);

  // Step 3 — ensure the user row exists. Per TASK-006 note (a), every
  // downstream table (events, mission_progress, balances) FKs to users.id;
  // INSERT OR IGNORE is the idempotent primitive.
  await ensureUser(c.env.DB, userId);

  // Step 4 — mint the JWT. Lifetime is 1 hour per plan §5; the JTI is a
  // 16-byte random hex string that doubles as the denylist key in KV.
  //
  // Phase 8 / TASK-003: when `kind === "demo"` we add it to the JWT payload
  // so the `/v1/demo/reset` route can gate dangerous data-wiping. The claim
  // is intentionally not exposed in the response — only the JWT carries it
  // — because the only authoritative reader is `requireAuth` downstream.
  const iatSec = Math.floor(Date.now() / 1000);
  const expSec = iatSec + 3600;
  const payload: {
    sub: string;
    iat: number;
    exp: number;
    jti: string;
    kind?: "demo";
  } = { sub: userId, iat: iatSec, exp: expSec, jti: randomJti() };
  if (kind === "demo") payload.kind = "demo";
  const token = await sign(payload, c.env.JWT_SECRET);

  // expiresAt is returned in ms-epoch for SDK convenience (JS `Date.now()` is
  // ms; pairing the unit avoids the SDK accidentally multiplying by 1000).
  return c.json({ token, expiresAt: expSec * 1000 }, 200);
});

export default auth;
