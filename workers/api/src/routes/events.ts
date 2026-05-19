/**
 * POST /v1/events — event ingestion endpoint.
 *
 * Pipeline (in order — see brief TASK-008 §"Route handler logic"):
 *
 *   1. requireAuth middleware     → c.var.userId populated
 *   2. Rate-limiter DO check      → 200 allow, 429 reject (with Retry-After)
 *   3. Body validation            → 400 invalid_event on any failure
 *   4. userId match check         → 403 user_mismatch if body.userId !== JWT sub
 *   5. Idempotency check          → KV hit → return cached response w/ X-Idempotent-Replay
 *   6. ensureUser                 → idempotent INSERT into users
 *   7. insertEvent                → D1 INSERT; UNIQUE constraint → D1-replay fallback
 *   8. evaluateEvent (rules)      → TASK-009's evaluator returns MissionProgress[]
 *   9. writeEventDataPoint (AE)   → fire-and-forget telemetry
 *  10. putCached if idem key set  → store full response body for 24h
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
 * Coordination with TASK-009 (teammate A): we import `evaluateEvent` from
 * `../rules`, passing missions fetched via `listMissions` verbatim. The
 * locked contract is:
 *
 *   evaluateEvent(db, event, candidateMissions): Promise<MissionProgress[]>
 *
 * A's evaluator must not assume any field projection — missions arrive
 * exactly as `rowToMission` returns them.
 */
import type { Event } from "@questkit/types";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAuth } from "../auth/middleware";
import {
  ensureUser,
  getEventByIdemKey,
  insertEvent,
  listMissions,
} from "../db/schema";
import { evaluateEvent } from "../rules";
import { writeEventDataPoint } from "../services/ae";
import * as idem from "../services/idempotency";

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

  // Step 5: idempotency cache check (primary defence).
  if (effectiveIdemKey !== undefined) {
    const cached = await idem.getCached<EventsResponse>(
      c.env.CACHE,
      userId,
      effectiveIdemKey,
    );
    if (cached !== null) {
      // Cache HIT — return cached response with replay header.
      return c.json(cached, 200, { "x-idempotent-replay": "hit" });
    }
  }

  // Step 6: ensure the user row exists (FK for events / mission_progress).
  await ensureUser(c.env.DB, userId);

  // Step 7: insert the event row. UUIDv4 for the primary id.
  const eventId = crypto.randomUUID();
  const eventToInsert: Event = {
    userId,
    name: body.name,
    payload: body.payload,
    timestamp: body.timestamp,
    ...(effectiveIdemKey !== undefined
      ? { idempotencyKey: effectiveIdemKey }
      : {}),
  };
  try {
    await insertEvent(c.env.DB, { ...eventToInsert, id: eventId });
  } catch (err) {
    // Per TASK-006 note (b): treat a UNIQUE constraint violation on the
    // partial-unique index `idx_events_user_idem` the same as a KV cache
    // hit — fetch the prior event, rebuild the response, cache it for
    // future calls.
    if (
      effectiveIdemKey !== undefined &&
      err instanceof Error &&
      /UNIQUE constraint|constraint failed/i.test(err.message)
    ) {
      const prior = await getEventByIdemKey(c.env.DB, userId, effectiveIdemKey);
      if (prior !== null) {
        // Rebuild a response from the prior event row. We can't replay the
        // rule engine here (the original missionsUpdated computation is lost
        // — D1 doesn't journal it). Best-effort: return an empty array. This
        // matches the contract because the FIRST call already broadcast its
        // updates; this call is a no-op replay.
        const replay: EventsResponse = {
          accepted: true,
          eventId: prior.id,
          missionsUpdated: [],
        };
        await idem.putCached(c.env.CACHE, userId, effectiveIdemKey, replay);
        return c.json(replay, 200, { "x-idempotent-replay": "db-hit" });
      }
    }
    throw err;
  }

  // Step 8: run the rule engine.
  //
  // ⚠️ TODO (TASK-010 follow-up): fetch-all-then-filter is fine for the 6
  // seeded missions; for production we want a DB-side filter on
  // `missions.criteria_json -> eventName = body.name` and possibly on
  // `campaign window`. listMissions() doesn't expose those yet — TASK-010
  // can add a `byEventName` / `activeNow` filter then.
  const { missions: candidateMissions } = await listMissions(c.env.DB);
  const updated = await evaluateEvent(
    c.env.DB,
    eventToInsert,
    candidateMissions,
  );

  // Step 9: AE write. Country comes from the underlying Request's cf object;
  // undefined in test / local dev.
  // `c.req.raw.cf` is typed as `IncomingRequestCfProperties | CfProperties`
  // depending on context; reading `.country` (string | undefined) is safe.
  // exactOptionalPropertyTypes is on, so we only set requestCountry when
  // we actually have a value (otherwise omit the key entirely).
  const cf = c.req.raw.cf as { country?: string } | undefined;
  writeEventDataPoint(c.env.EVENTS_AE, eventToInsert, {
    ...(cf?.country !== undefined ? { requestCountry: cf.country } : {}),
    missionsMatched: updated.length,
    nowMs: Date.now(),
  });

  // Step 10: build response, then cache if an idempotency key was provided.
  const response: EventsResponse = {
    accepted: true,
    eventId,
    missionsUpdated: updated.map((p) => p.missionId),
  };
  if (effectiveIdemKey !== undefined) {
    await idem.putCached(c.env.CACHE, userId, effectiveIdemKey, response);
  }
  return c.json(response, 200);
});

export default events;
