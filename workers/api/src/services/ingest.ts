/**
 * Event ingest core — shared pipeline used by:
 *   - the HTTP route `POST /v1/events` (auth + rate-limit + body parse upstream)
 *   - the RPC entrypoint `ApiService.ingestEvent` (trusted, no auth / rate-limit)
 *
 * Performs steps 5–10 of the route pipeline (idempotency check → ensureUser →
 * insertEvent → rule engine → Analytics Engine → cache). Steps 1–4 (auth,
 * rate-limit, body shape, userId match) are the caller's responsibility.
 *
 * Extracted in TASK-022 so the webhook-consumer worker can invoke the same
 * mission-rule + AE + idempotency machinery via `WorkerEntrypoint` RPC without
 * going through HTTP. The route shape and the RPC shape diverge only in their
 * outer envelope; the engine work is identical.
 *
 * Response shape (locked, mirrors the route): `{ accepted: true, eventId,
 * missionsUpdated[], replayed }`. `replayed` is "kv" when the KV idempotency
 * cache hit, "db" when the partial unique index caught the second write, or
 * `false` for a fresh ingest.
 *
 * Idempotency-key precedence is OUT of scope here — callers compute the
 * effective key (header vs body) before invoking this function and pass it as
 * `body.idempotencyKey`. The route uses RFC 9530 semantics (header wins);
 * the RPC entrypoint just threads whatever the message carries.
 */
import type { Event } from "@questkit/types";
import {
  ensureUser,
  getEventByIdemKey,
  insertEvent,
  listMissions,
} from "../db/schema";
import { evaluateEvent } from "../rules";
import { writeEventDataPoint } from "./ae";
import * as idem from "./idempotency";

/**
 * Body shape ingestEventCore accepts. Matches the validated `EventBody` from
 * the events route; the RPC entrypoint synthesises one from the canonical
 * `Event` shape coming off the queue.
 */
export interface IngestEventBody {
  userId: string;
  name: string;
  payload: Record<string, unknown>;
  timestamp: number;
  idempotencyKey?: string;
}

/**
 * Context the route layer can optionally pass through. Today only carries the
 * Cloudflare-detected request country so the AE write retains parity with the
 * route's prior behaviour. The RPC entrypoint passes `undefined` here — webhook
 * events arrive without a meaningful request country.
 */
export interface IngestEventContext {
  requestCountry?: string;
}

/**
 * Structured result. The route layer wraps this in its HTTP response shape;
 * the RPC entrypoint projects its own.
 */
export interface IngestResult {
  accepted: true;
  eventId: string;
  missionsUpdated: string[];
  /** `false` for fresh ingest, "kv" for KV-cache replay, "db" for partial-unique-index replay. */
  replayed: false | "kv" | "db";
}

/**
 * Run steps 5–10 of the events pipeline against a validated body.
 *
 * Caller MUST have already:
 *   - authenticated and matched body.userId to the authenticated subject
 *     (only relevant for the route — the RPC entrypoint is trusted),
 *   - rate-limited (only the route does this),
 *   - validated the body shape via parseEventBody (or equivalent).
 *
 * On idempotent replay (KV hit or D1 partial-unique-index hit), `replayed`
 * is set and `missionsUpdated` may be empty — the original call already
 * fanned out the rule engine, so the replay is a no-op. This matches the
 * route's prior behaviour.
 *
 * Throws on unexpected D1 errors (anything that isn't a UNIQUE constraint
 * violation on the idempotency partial index).
 */
export async function ingestEventCore(
  env: Env,
  body: IngestEventBody,
  ctx: IngestEventContext = {},
): Promise<IngestResult> {
  const { userId } = body;
  const effectiveIdemKey = body.idempotencyKey;

  // Step 5: idempotency cache check (primary defence — KV).
  if (effectiveIdemKey !== undefined) {
    const cached = await idem.getCached<{
      accepted: true;
      eventId: string;
      missionsUpdated: string[];
    }>(env.CACHE, userId, effectiveIdemKey);
    if (cached !== null) {
      return {
        accepted: true,
        eventId: cached.eventId,
        missionsUpdated: cached.missionsUpdated,
        replayed: "kv",
      };
    }
  }

  // Step 6: ensure the user row exists (FK for events / mission_progress).
  await ensureUser(env.DB, userId);

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
    await insertEvent(env.DB, { ...eventToInsert, id: eventId });
  } catch (err) {
    // D1-replay fallback: a UNIQUE constraint violation on the partial-unique
    // index `idx_events_user_idem` means a concurrent caller already inserted
    // this `(user_id, idempotency_key)` pair before our KV check populated.
    // Surface this as a replay so the caller's response stays consistent.
    if (
      effectiveIdemKey !== undefined &&
      err instanceof Error &&
      /UNIQUE constraint|constraint failed/i.test(err.message)
    ) {
      const prior = await getEventByIdemKey(env.DB, userId, effectiveIdemKey);
      if (prior !== null) {
        const replay = {
          accepted: true as const,
          eventId: prior.id,
          missionsUpdated: [],
        };
        await idem.putCached(env.CACHE, userId, effectiveIdemKey, replay);
        return { ...replay, replayed: "db" };
      }
    }
    throw err;
  }

  // Step 8: run the rule engine.
  //
  // ⚠️ TODO (TASK-010 follow-up — carried from routes/events.ts): fetch-all-
  // then-filter is fine for the 6 seeded missions; production wants a
  // DB-side filter on `missions.criteria_json -> eventName = body.name`.
  const { missions: candidateMissions } = await listMissions(env.DB);
  const updated = await evaluateEvent(env.DB, eventToInsert, candidateMissions);

  // Step 9: AE write. `requestCountry` only flows through for HTTP callers;
  // RPC ingests omit it (no meaningful request country on a queued event).
  writeEventDataPoint(env.EVENTS_AE, eventToInsert, {
    ...(ctx.requestCountry !== undefined
      ? { requestCountry: ctx.requestCountry }
      : {}),
    missionsMatched: updated.length,
    nowMs: Date.now(),
  });

  // Step 10: build the response shape, then cache if an idempotency key was
  // provided so subsequent replays return byte-identical JSON.
  const response = {
    accepted: true as const,
    eventId,
    missionsUpdated: updated.map((p) => p.missionId),
  };
  if (effectiveIdemKey !== undefined) {
    await idem.putCached(env.CACHE, userId, effectiveIdemKey, response);
  }
  return { ...response, replayed: false };
}
