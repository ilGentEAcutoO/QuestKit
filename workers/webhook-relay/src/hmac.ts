/**
 * Stripe-style HMAC-SHA256 webhook signature verification.
 *
 * Header format (Stripe-compatible):  `t=<unix-seconds>,v1=<hex-sha256>`
 *
 * Signed payload is the literal string `${t}.${rawBody}`. The HMAC must be
 * computed over the raw request bytes — not the JSON-reparsed object — because
 * any difference in whitespace, key ordering, or unicode normalisation will
 * shift the digest. Hence `index.ts` reads `c.req.text()` (not `c.req.json()`)
 * before invoking us.
 *
 * Timing-safety: `crypto.subtle.verify('HMAC', …)` is constant-time by spec.
 * We use it directly on the recomputed signature; we do NOT fall back to a
 * naïve `=== `-comparison of hex strings. The boolean it returns is the only
 * authority on signature equality.
 *
 * Replay window: signatures are valid for ±`toleranceSec` (default 300s)
 * around the local clock. Anything outside that band returns
 * `signature_expired` — the canonical Stripe behaviour and what TASK-022
 * relies on (the consumer never sees replays this Worker rejected).
 */

/** Mirrors api worker's pattern — narrow KeyUsage to what we use. */
type HmacKeyUsage = "sign" | "verify";

export interface VerifyOptions {
  /** Maximum permitted skew between header `t` and `now()`, in seconds. */
  toleranceSec?: number;
  /** Clock injection for deterministic tests. Returns unix seconds. */
  now?: () => number;
}

export type VerifyReason =
  | "malformed_signature"
  | "invalid_signature"
  | "signature_expired";

export type VerifyResult = { ok: true } | { ok: false; reason: VerifyReason };

const DEFAULT_TOLERANCE_SEC = 300;

/**
 * Verify a Stripe-style HMAC signature. Returns a discriminated result so the
 * caller (the route handler) can map the failure reason to an HTTP status
 * code without re-parsing exception messages.
 *
 * Order of checks:
 *   1) header is parseable                → malformed_signature
 *   2) timestamp inside tolerance window  → signature_expired
 *   3) HMAC matches                       → invalid_signature
 *
 * Steps 2 and 3 could in theory swap places; we run skew first so an attacker
 * can't distinguish "this body matches the secret but is stale" from "this
 * body never matched the secret" via timing of the HMAC compute. The signed
 * payload includes `t`, so a stale signature can't be replayed regardless.
 */
export async function verify(
  rawBody: string,
  header: string,
  secret: string,
  opts: VerifyOptions = {},
): Promise<VerifyResult> {
  const toleranceSec = opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));

  const parsed = parseHeader(header);
  if (parsed === null) {
    return { ok: false, reason: "malformed_signature" };
  }
  const { t, v1Hex } = parsed;

  if (Math.abs(now() - t) > toleranceSec) {
    return { ok: false, reason: "signature_expired" };
  }

  const sigBytes = hexToBytes(v1Hex);
  if (sigBytes === null) {
    // Defensive — parseHeader already validated the hex shape.
    return { ok: false, reason: "malformed_signature" };
  }

  const key = await importHmacKey(secret, ["verify"]);
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(`${t}.${rawBody}`),
  );
  if (!ok) return { ok: false, reason: "invalid_signature" };
  return { ok: true };
}

// -----------------------------------------------------------------------------
// internal helpers
// -----------------------------------------------------------------------------

/**
 * Parse `t=<int>,v1=<hex>` (any order, optional whitespace between pairs).
 * Returns `null` on any structural issue so the caller can short-circuit with
 * a single `malformed_signature` reason.
 */
function parseHeader(header: string): { t: number; v1Hex: string } | null {
  if (typeof header !== "string" || header.length === 0) return null;

  let tSec: number | null = null;
  let v1Hex: string | null = null;

  for (const rawPair of header.split(",")) {
    const pair = rawPair.trim();
    const eq = pair.indexOf("=");
    if (eq <= 0) return null;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === "t") {
      // Strict-integer parse: Stripe sends seconds-only, no decimals.
      if (!/^\d+$/.test(value)) return null;
      tSec = Number.parseInt(value, 10);
      if (!Number.isFinite(tSec)) return null;
    } else if (key === "v1") {
      // Hex must be even-length and limited to [0-9a-fA-F]. We don't enforce
      // a specific length here so future digest sizes (theoretical) still
      // parse; the actual byte comparison is `crypto.subtle.verify`'s job.
      if (value.length === 0 || value.length % 2 !== 0) return null;
      if (!/^[0-9a-f]+$/i.test(value)) return null;
      v1Hex = value;
    }
    // Unknown keys (e.g. `v0=`) are ignored, matching Stripe's forward-compat
    // policy.
  }

  if (tSec === null || v1Hex === null) return null;
  return { t: tSec, v1Hex };
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

async function importHmacKey(
  secret: string,
  usages: HmacKeyUsage[],
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}
