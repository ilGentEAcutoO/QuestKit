/**
 * POST /v1/events — event ingestion endpoint.
 *
 * Pipeline (in order — see brief TASK-008 §"Route handler logic"):
 *
 *   1. requireAuth middleware     → c.var.userId populated
 *   2. Rate-limiter DO check      → 200 allow, 429 reject (with Retry-After)
 *   3. Body validation            → 400 invalid_event on any failure
 *   4. userId match check         → 403 user_mismatch if body.userId !== JWT sub
 *   5–10. ingestEventCore         → idempotency → ensureUser → insertEvent →
 *                                    rule engine → AE → cache. See
 *                                    `services/ingest.ts` for the shared pipeline
 *                                    that the queue consumer also calls via RPC.
 *  11. Return 200                 → { accepted, eventId, missionsUpdated[] }
 *
 * Response shape (locked):
 *   { accepted: true, eventId: string, missionsUpdated: string[] }
 *
 * Idempotent replays carry `X-Idempotent-Replay: hit` (KV) or `db-hit` (the
 * partial-unique index caught a write the KV layer missed).
 *
 * Header precedence: `Idempotency-Key` request header wins over the body
 * field `idempotencyKey` when both are present. RFC 9530 (draft) treats the
 * header as canonical and several SDKs default to using only the header.
 *
 * TASK-022 refactor note: steps 5–10 used to live inline here; they were
 * extracted into `services/ingest.ts::ingestEventCore` so the webhook-consumer
 * worker can share the same engine via `WorkerEntrypoint` RPC. The route still
 * owns auth, rate-limit, body validation, and userId match — those are
 * HTTP-only concerns the trusted RPC path skips.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAuth } from "../auth/middleware";
import { ingestEventCore } from "../services/ingest";

interface EventsVars {
  userId: string;
  jti: string;
}

const events = new Hono<{ Bindings: Env; Variables: EventsVars }>();

// Mount auth on every route under /v1/events. Path is "/*" because we're
// mounted at /v1/events by the parent app, so the middleware sees relative
// paths.
events.use("/*", requireAuth());

/** The locked response shape (matches the brief). */
interface EventsResponse {
  accepted: true;
  eventId: string;
  missionsUpdated: string[];
}

/** Body shape the route accepts. */
interface EventBody {
  userId: string;
  name: string;
  payload: Record<string, unknown>;
  timestamp: number;
  idempotencyKey?: string;
}

/**
 * Validate a parsed JSON body shape into an `EventBody` or return null.
 * Returns null on ANY shape failure — the route translates that into a 400
 * `invalid_event` response.
 */
function parseEventBody(raw: unknown): EventBody | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const userId = obj.userId;
  const name = obj.name;
  const payload = obj.payload;
  const timestamp = obj.timestamp;
  const idempotencyKey = obj.idempotencyKey;

  if (typeof userId !== "string" || userId.length === 0) return null;
  if (typeof name !== "string" || name.length === 0) return null;
  // `payload` must be a plain object — null is rejected (typeof null === "object")
  // and arrays are rejected (Array.isArray).
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return null;
  if (idempotencyKey !== undefined && typeof idempotencyKey !== "string") {
    return null;
  }

  const validated: EventBody = {
    userId,
    name,
    payload: payload as Record<string, unknown>,
    timestamp,
  };
  if (typeof idempotencyKey === "string" && idempotencyKey.length > 0) {
    validated.idempotencyKey = idempotencyKey;
  }
  return validated;
}

/**
 * Read the rate-limiter DO.
 *
 * The DO returns 200 on allow, 429 on reject (with a `Retry-After` header
 * + JSON body containing `retryAfterMs`). Any other status is unexpected —
 * we log and allow (defensive: a broken limiter shouldn't take down the
 * whole event pipeline). Network-level failures (DO unreachable, fetch
 * throws) are caught in the call-site so they don't propagate as a 500.
 *
 * @throws HTTPException(429) when the DO returns 429
 */
async function checkRateLimit(env: Env, userId: string): Promise<void> {
  const id = env.RATE_LIMITER.idFromName(userId);
  const stub = env.RATE_LIMITER.get(id);
  let rlResp: Response;
  try {
    rlResp = await stub.fetch("https://_/check?limit=100&window=60000");
  } catch (err) {
    // Network-level failure talking to the DO — fail open (allow) so a
    // limiter outage doesn't sink the ingest pipeline. The error is logged
    // for the operator to investigate; the 429 path still trips when the DO
    // recovers.
    console.warn("[events] rate-limiter fetch threw, allowing request", err);
    return;
  }
  if (rlResp.status === 200) return;
  if (rlResp.status === 429) {
    // Propagate as HTTPException with the DO's body + headers intact (the
    // Retry-After header is the client's only signal for when to retry).
    throw new HTTPException(429, { message: "rate_limited", res: rlResp });
  }
  // Unexpected status — log and allow. We chose "allow" over "deny" here so
  // a bug in the limiter never causes a region-wide ingest outage; the
  // failure mode is "limit not enforced for a brief moment" which is
  // recoverable, vs. "no events flow at all".
  console.warn(
    `[events] rate-limiter DO returned unexpected status ${rlResp.status} — allowing`,
  );
}

events.post("/", async (c) => {
  const userId = c.var.userId;

  // Step 1: rate limit. Throws HTTPException(429) on reject.
  await checkRateLimit(c.env, userId);

  // Step 2: parse body.
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: "invalid_event" }, 400);
  }
  const body = parseEventBody(raw);
  if (body === null) {
    return c.json({ error: "invalid_event" }, 400);
  }

  // Step 3: userId match check.
  if (body.userId !== userId) {
    return c.json({ error: "user_mismatch" }, 403);
  }

  // Step 4: resolve the effective idempotency key. Header wins over body
  // when both are present (RFC 9530 / sdk-friendly).
  const headerKey = c.req.header("idempotency-key");
  const effectiveIdemKey =
    typeof headerKey === "string" && headerKey.length > 0
      ? headerKey
      : body.idempotencyKey;

  // Steps 5–10: shared engine. The route owns request-level wiring (the
  // idempotency header resolution above + the AE country lookup below); the
  // service owns the database + KV + AE machinery so the queue consumer can
  // reuse it via RPC.
  const cf = c.req.raw.cf as { country?: string } | undefined;
  const result = await ingestEventCore(
    c.env,
    {
      userId,
      name: body.name,
      payload: body.payload,
      timestamp: body.timestamp,
      ...(effectiveIdemKey !== undefined
        ? { idempotencyKey: effectiveIdemKey }
        : {}),
    },
    cf?.country !== undefined ? { requestCountry: cf.country } : {},
  );

  const responseBody: EventsResponse = {
    accepted: true,
    eventId: result.eventId,
    missionsUpdated: result.missionsUpdated,
  };
  if (result.replayed === "kv") {
    return c.json(responseBody, 200, { "x-idempotent-replay": "hit" });
  }
  if (result.replayed === "db") {
    return c.json(responseBody, 200, { "x-idempotent-replay": "db-hit" });
  }
  return c.json(responseBody, 200);
});

export default events;
