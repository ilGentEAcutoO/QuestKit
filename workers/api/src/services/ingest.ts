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
import type { Event, MissionProgress, SDKUpdate } from "@questkit/types";
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
 * Per-call ceiling for any SSE_HUB DO RPC. Mirrors the constant in
 * routes/missions.ts. See that file for the rationale; the short version is
 * that broadcasts are best-effort, so capping at 2s lets us guarantee a
 * wedged DO never deadlocks the worker request thread.
 */
const SSE_HUB_TIMEOUT_MS = 2000;

/**
 * Best-effort fan-out of mission progress updates to the user's SSE_HUB
 * Durable Object. Each updated progress row becomes either a
 * `mission.completed` SDKUpdate (if the new status is "completed" or
 * "claimed") or a `mission.progress` SDKUpdate. The DO broadcasts to
 * every connected client.
 *
 * Mirrors `tryBroadcastClaim` in routes/missions.ts. Failures are
 * swallowed — the demo's polling fallback covers SSE outages, and a
 * broadcast error must NEVER take down event ingestion.
 *
 * Without this fan-out, /v1/events POST succeeded on the server but the
 * client's SSE subscriber never saw the resulting progress changes —
 * the demo's EventLog drawer stayed empty even though missions DID
 * progress server-side. Surfaced by the live click-through test sweep.
 *
 * Deadlock hardening (Phase 8 / v0.1.4 TASK-001): each stub.fetch arms
 * `AbortSignal.timeout(2000)` so a wedged DO can never hold the call. The
 * CALLER detaches the whole `tryBroadcastProgress` invocation via
 * `ctx.waitUntil(...)` (see `IngestEventContext.waitUntil`) so even
 * healthy-but-slow broadcasts don't gate the ingest response.
 */
async function tryBroadcastProgress(
  env: Env,
  userId: string,
  updated: MissionProgress[],
): Promise<void> {
  if (updated.length === 0) return;
  try {
    const stubId = env.SSE_HUB.idFromName(userId);
    const stub = env.SSE_HUB.get(stubId);
    for (const progress of updated) {
      const update: SDKUpdate =
        progress.status === "completed" || progress.status === "claimed"
          ? { type: "mission.completed", data: progress }
          : { type: "mission.progress", data: progress };
      const resp = await stub.fetch("https://_/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(update),
        signal: AbortSignal.timeout(SSE_HUB_TIMEOUT_MS),
      });
      if (resp.status !== 200) {
        console.warn(
          `[ingest] sse-hub returned unexpected status ${resp.status}`,
        );
      }
    }
  } catch (err) {
    // Includes AbortError from the timeout signal.
    console.warn("[ingest] sse-hub broadcast threw, swallowed", err);
  }
}

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
 * Context the route layer can optionally pass through.
 *
 *   - `requestCountry` — Cloudflare-detected request country so the AE write
 *     retains parity with the route's prior behaviour. The RPC entrypoint
 *     passes `undefined` here — webhook events arrive without a meaningful
 *     request country.
 *   - `waitUntil` — when provided, the SSE broadcast fan-out is detached
 *     from the response path via this callback (typically wired to
 *     `c.executionCtx.waitUntil` for HTTP and `this.ctx.waitUntil` for the
 *     `WorkerEntrypoint` RPC). Without it the broadcast is awaited inline,
 *     which is fine for non-request contexts (tests, scripts) but would
 *     hang client requests if any subscriber's writer were stalled — see
 *     TASK-001 (Phase 8 / v0.1.4) for the regression history.
 */
export interface IngestEventContext {
  requestCountry?: string;
  waitUntil?: (promise: Promise<unknown>) => void;
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
      // v0.1.9 F1 — symmetry with the D1 partial-unique-index replay branch
      // below (line ~216), which has always returned `missionsUpdated: []`.
      // Echoing the cached non-empty array caused the SDK's useMissions
      // optimistic counter to bump again on every replay, producing a
      // silent 409 `claim_not_ready`. Replays are no-ops by contract.
      return {
        accepted: true,
        eventId: cached.eventId,
        missionsUpdated: [],
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

  // Step 10: fan out mission updates over SSE so subscribed clients see
  // live progress (this is the entire point of the SSE hub). Best-effort:
  // a hub miss must NEVER fail the ingest itself.
  //
  // Detached via `ctx.waitUntil` when the caller supplies one (Phase 8 /
  // v0.1.4 TASK-001). HTTP routes and the WorkerEntrypoint RPC both have
  // an ExecutionContext to plumb in; tests/scripts that don't bother fall
  // back to the awaited path (the test environments don't have wedged DOs
  // so the latency cost is negligible).
  if (ctx.waitUntil !== undefined) {
    ctx.waitUntil(tryBroadcastProgress(env, userId, updated));
  } else {
    await tryBroadcastProgress(env, userId, updated);
  }

  // Step 11: build the response shape, then cache if an idempotency key was
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
