/**
 * Workers-AI personalisation service (TASK-017, updated Phase 8 / v0.1.4 TASK-002).
 *
 * Exposes `recommendMissions(env, userId, recentEvents, activeMissions)` —
 * which picks up to 3 missions for a user via `@cf/meta/llama-3.1-8b-instruct-fast`
 * and caches the result in KV for 1 hour.
 *
 * ## Design choices
 *
 *   - Pure-ish service: takes `env` (the subset `{ AI, CACHE }`) as the first
 *     arg, no Hono coupling. The route handler composes idempotent loaders
 *     (events, missions) and calls this.
 *
 *   - Cache key shape: `rec:${userId}` with 1h TTL. The brief locked this
 *     verbatim — same KV namespace (CACHE) as idempotency / JWT denylist.
 *
 *   - Security (plan §5 "AI prompt injection"):
 *     • Event payload VALUES are NEVER sent to the LLM. We summarise events
 *       as `name + count` only — host-supplied data (which may include PII
 *       or attempted prompt injections) cannot reach the model.
 *     • Mission data sent: id + criteria.eventName + criteria.count only.
 *
 *   - Validation: the LLM may hallucinate. We assert response shape strictly
 *     and DROP missionIds that aren't in the `activeMissions` list (we do
 *     NOT throw on hallucinated IDs — the brief explicitly said "filter out").
 *
 *   - Envelope tolerance (Phase 8 / v0.1.4): `@cf/meta/llama-3.1-8b-instruct-fast`
 *     may return the payload in three different shapes depending on Workers AI
 *     runtime version:
 *       1. `{ response: "<json-string>" }` — original v0.1.x assumption.
 *       2. `{ result: <object> }` — newer runtime variant.
 *       3. raw `<object>` — payload at the top level.
 *     `normalizeAiEnvelope` tries them in order and returns the first that
 *     yields a parseable payload. If none works → fallback (see below).
 *
 *   - Graceful fallback (Phase 8 / v0.1.4): instead of throwing on malformed
 *     responses, the service returns a fallback variant of
 *     `RecommendationsResult` (`{ fallback: true, missionIds: [], … }`). The
 *     route surfaces this as a 200 response so the UI renders a tasteful
 *     empty-state ("AI picks unavailable right now") rather than a red 502.
 *     Fallback results are NEVER cached — the next call retries the AI.
 *
 *   - Model id: `@cf/meta/llama-3.1-8b-instruct-fast` — locked by plan
 *     amendment A8 (base `llama-3.1-8b-instruct` was deprecated 2026-05-30).
 *     The `-fast` variant doesn't appear in the generated AiModels d.ts so
 *     `env.AI.run(...)` falls through to the `string & {} -> Record<string,
 *     unknown>` overload and we cast its return shape ourselves.
 */
import type { Event, Mission } from "@questkit/types";

/** KV cache TTL — brief-locked at 3600 seconds (1 hour). */
export const RECOMMENDATIONS_CACHE_TTL_SECONDS = 3600;

/** Workers AI model id — locked by plan amendment A8. DO NOT CHANGE. */
export const AI_MODEL_ID = "@cf/meta/llama-3.1-8b-instruct-fast" as const;

/**
 * System prompt — locked verbatim by the brief. The wording is deliberately
 * short to keep prompt tokens low (Workers AI inference cost scales with both
 * input and output tokens).
 */
export const SYSTEM_PROMPT = `You are an encouraging gamification coach. Pick up to 3 missions from the active list that build on the user's recent activity. Favor missions whose criteria mention event types the user has already fired — momentum matters.
Return ONLY valid JSON:
  { "missionIds": string[], "reason": string }
The reason MUST be a single warm sentence addressed to the user ("You've been..."). Max 30 words. No prose.`;

/**
 * Build the KV cache key. Per-user scope means multi-user apps don't collide.
 * Mirrors the convention used by `services/idempotency.ts`.
 */
export function cacheKey(userId: string): string {
  return `rec:${userId}`;
}

/**
 * Result returned to the route layer.
 *
 * `fallback: true` indicates the AI call failed (malformed response, etc.) and
 * the caller should render an empty-state. When `fallback` is absent or false,
 * `missionIds`/`reason` carry the real recommendation. We use an optional
 * field (rather than a strict discriminated union) so existing callers keep
 * working — they can ignore `fallback` and they will see `missionIds: []`
 * which collapses to the same "no recommendations" branch they already have.
 */
export interface RecommendationsResult {
  missionIds: string[];
  reason: string;
  /** True when served from KV cache (no AI call this request). */
  cached: boolean;
  /**
   * Optional — `true` indicates the AI was unavailable / malformed and the
   * result is a graceful empty placeholder. The route surfaces this as part
   * of a 200 response so the UI never sees a red 502.
   */
  fallback?: boolean;
}

/**
 * Internal — shape the AI must produce inside its JSON-only response.
 */
interface AiPayload {
  missionIds: string[];
  reason: string;
}

/**
 * Static fallback reason. Surfaces in the UI when the AI is unavailable —
 * intentionally vague (no error code, no model name) so the empty-state
 * reads like a normal product message rather than a developer leak.
 */
export const FALLBACK_REASON = "AI picks unavailable right now.";

/** Build a non-cacheable fallback result. */
function fallbackResult(): RecommendationsResult {
  return {
    missionIds: [],
    reason: FALLBACK_REASON,
    cached: false,
    fallback: true,
  };
}

/**
 * Validate the parsed JSON shape. Returns the typed payload on success,
 * returns `null` on any structural defect (caller surfaces a fallback).
 *
 * Phase 8 / v0.1.4: previously threw a typed error. Switched to a null-return
 * so the caller can compose multiple parse strategies (try the `.response`
 * string, then `.result`, then raw) without each one having to catch.
 */
function validateAiPayload(raw: unknown): AiPayload | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const missionIds = obj.missionIds;
  const reason = obj.reason;

  if (!Array.isArray(missionIds)) return null;
  for (const id of missionIds) {
    if (typeof id !== "string") return null;
  }
  if (typeof reason !== "string") return null;
  return { missionIds: missionIds as string[], reason };
}

/**
 * Parse a JSON-shaped string. Returns null on parse failure (caller decides
 * whether that's an error). We're more lenient than `JSON.parse` would be on
 * its own — we try to grab the first `{...}` block from the string in case
 * the LLM prefixed the JSON with prose despite the system prompt.
 */
function tryParseJson(raw: string): unknown | null {
  // Fast path — the whole string is JSON.
  try {
    return JSON.parse(raw);
  } catch {
    // Slow path — find the first `{` and the matching last `}`.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Result envelope from `normalizeAiEnvelope`.
 *
 * On success (`payload !== null`), the caller uses the parsed AiPayload and
 * `reason`/`strategy` carry diagnostic info ONLY for logs.
 *
 * On failure (`payload === null`), the caller surfaces a fallback and emits a
 * single-line warn that includes the populated `reason` + `fingerprint` so an
 * operator can tell from `wrangler tail` whether the AI is regressing (e.g.
 * runtime returned a new envelope shape) vs. hallucinating non-JSON.
 *
 * `fingerprint` is a short structural summary of the raw AI response — the
 * top-level keys + their value types — NEVER the values themselves (the
 * values may include LLM-leaked PII or attempted prompt-injection). Bounded
 * to ~200 chars to keep tail output tidy.
 */
interface EnvelopeOutcome {
  payload: AiPayload | null;
  /** Which envelope strategy won (success) OR the last reason for failure. */
  strategy:
    | "response-string"
    | "result-string"
    | "result-object"
    | "raw-object"
    | "no-strategy-matched"
    | "not-an-object";
  /** Populated on failure — short structural fingerprint for the tail log. */
  fingerprint?: string;
}

/**
 * Build a bounded, value-stripped fingerprint of an unknown AI response so it
 * can land in a log line without leaking model output or PII. We surface only
 * key names + value types/lengths — enough to tell apart "runtime regressed
 * to a new envelope shape" from "AI returned non-JSON prose" without exposing
 * what the user typed or what the LLM said.
 */
function envelopeFingerprint(raw: unknown): string {
  if (raw === null) return "null";
  const t = typeof raw;
  if (t !== "object") return t;
  if (Array.isArray(raw)) return `array(len=${raw.length})`;
  const obj = raw as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of Object.keys(obj).slice(0, 8)) {
    const v = obj[k];
    if (typeof v === "string") {
      parts.push(`${k}:string(len=${v.length})`);
    } else if (typeof v === "object" && v !== null) {
      parts.push(`${k}:${Array.isArray(v) ? "array" : "object"}`);
    } else {
      parts.push(`${k}:${typeof v}`);
    }
  }
  let s = `{${parts.join(",")}}`;
  if (s.length > 200) s = `${s.slice(0, 197)}...`;
  return s;
}

/**
 * Normalize the Workers-AI return envelope into a validated `AiPayload`.
 *
 * Tries each of these strategies in order, returning the first one that
 * yields a valid payload (i.e. `validateAiPayload` succeeds):
 *
 *   1. `aiResponse.response` is a string → JSON.parse it, validate.
 *   2. `aiResponse.result` is an object → validate it directly.
 *   3. `aiResponse` itself is an object that already looks like the payload
 *      (has a `missionIds` field) → validate it.
 *
 * Returns `{ payload: null, strategy, fingerprint }` if none of the strategies
 * produce a valid payload — the caller emits a single-line warn so the
 * specific failure mode is visible in `wrangler tail` and translates the
 * null into a fallback result rather than throwing.
 *
 * This tolerance is necessary because `@cf/meta/llama-3.1-8b-instruct-fast`
 * (the locked model id per amendment A8) returns different envelope shapes
 * across Workers AI runtime versions — the original implementation only
 * handled shape 1 and broke in production when the runtime started returning
 * shape 2.
 */
function normalizeAiEnvelope(aiResponse: unknown): EnvelopeOutcome {
  if (typeof aiResponse !== "object" || aiResponse === null) {
    return {
      payload: null,
      strategy: "not-an-object",
      fingerprint: envelopeFingerprint(aiResponse),
    };
  }
  const obj = aiResponse as Record<string, unknown>;

  // Strategy 1: { response: "<json-string>" }
  if (typeof obj.response === "string") {
    const parsed = tryParseJson(obj.response);
    const payload = validateAiPayload(parsed);
    if (payload !== null) return { payload, strategy: "response-string" };
    // Fall through to next strategy if the .response string didn't validate.
  }

  // Strategy 2: { result: <object-or-json-string> }
  const result = obj.result;
  if (typeof result === "string") {
    const parsed = tryParseJson(result);
    const payload = validateAiPayload(parsed);
    if (payload !== null) return { payload, strategy: "result-string" };
  } else if (typeof result === "object" && result !== null) {
    const payload = validateAiPayload(result);
    if (payload !== null) return { payload, strategy: "result-object" };
  }

  // Strategy 3: raw object — payload is at the top level.
  const direct = validateAiPayload(obj);
  if (direct !== null) return { payload: direct, strategy: "raw-object" };

  return {
    payload: null,
    strategy: "no-strategy-matched",
    fingerprint: envelopeFingerprint(obj),
  };
}

/**
 * Build the user message — STRUCTURED summaries only.
 *
 * Per plan §5 "AI prompt injection" we MUST NOT serialise event payloads
 * into the LLM input. We do include:
 *
 *   - Event NAME and COUNT (count = how many times the user fired that name
 *     in the supplied window — caller aggregates).
 *   - Mission id, criteria.eventName, criteria.count.
 *
 * We do NOT include:
 *
 *   - Event payloads (host-controlled — attack surface).
 *   - Mission descriptions, rewards, or any free-form text.
 */
function buildUserMessage(
  recentEvents: Event[],
  activeMissions: Mission[],
): string {
  // Aggregate event NAMES to counts so the LLM sees patterns, not payloads.
  const eventCounts = new Map<string, number>();
  for (const e of recentEvents) {
    eventCounts.set(e.name, (eventCounts.get(e.name) ?? 0) + 1);
  }
  const eventLines: string[] = [];
  for (const [name, count] of eventCounts) {
    eventLines.push(`- ${name} (×${count})`);
  }

  const missionLines = activeMissions.map((m) => {
    return `- id=${m.id} requires ${m.criteria.eventName} ×${m.criteria.count}`;
  });

  return [
    "Recent activity:",
    eventLines.length > 0 ? eventLines.join("\n") : "(none)",
    "",
    "Active missions:",
    missionLines.length > 0 ? missionLines.join("\n") : "(none)",
  ].join("\n");
}

/**
 * Recommend up to 3 missions for the user.
 *
 * Cache HIT path: returns `{ ...cached, cached: true }` without invoking AI.
 * Cache MISS path: builds the prompt, calls `env.AI.run(...)`, normalizes the
 *   response envelope (3 accepted shapes), filters hallucinated IDs, caches
 *   the result for 1h, returns `{ ...result, cached: false }`.
 *
 * Fallback (Phase 8 / v0.1.4): if the AI returns a malformed / unparseable
 *   payload, this function returns `{ fallback: true, missionIds: [], ... }`
 *   instead of throwing. Fallback results are NOT cached — the next call
 *   retries the AI. The route handler surfaces fallback as a 200 response so
 *   the UI can render a tasteful empty-state.
 *
 * @throws Whatever `env.AI.run` throws on its own (the route catches separately
 *         and may surface 503 or fallback — see `routes/recommendations.ts`).
 *         This function does NOT throw on malformed AI responses any more.
 */
export async function recommendMissions(
  env: Pick<Env, "AI" | "CACHE">,
  userId: string,
  recentEvents: Event[],
  activeMissions: Mission[],
): Promise<RecommendationsResult> {
  // Step 1 — cache check.
  const key = cacheKey(userId);
  const cached = (await env.CACHE.get(key, "json")) as AiPayload | null;
  if (cached !== null) {
    return { ...cached, cached: true };
  }

  // Step 2 — build the prompt + call AI. The `env.AI.run` call may itself
  // throw (binding outage, model not available, timeout). We catch and log a
  // distinct reason so `wrangler tail` shows the failure mode at a glance —
  // the route's outer try/catch will translate the rethrow into a fallback.
  const userMessage = buildUserMessage(recentEvents, activeMissions);
  let aiResponse: unknown;
  try {
    aiResponse = await env.AI.run(AI_MODEL_ID, {
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
      max_tokens: 200,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    const errName = err instanceof Error ? err.name : typeof err;
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[ai] fallback reason=ai-run-threw model=${AI_MODEL_ID} errName=${errName} errMsg=${errMsg.slice(0, 200)}`,
    );
    // Re-throw so the route's outer try/catch surfaces a fallback 200 — we
    // keep the throw to preserve the previous binding-outage code path
    // (recommendations.ts handles it), but the log above means the operator
    // can now tell the AI throw apart from a malformed-response fallback.
    throw err;
  }

  // Step 3 — normalize the envelope (3 accepted shapes) into a validated
  // payload. On failure the outcome carries a distinct reason + fingerprint
  // so a single tail line tells us which envelope strategy failed and what
  // top-level keys/types the runtime returned (values stripped to avoid PII).
  const outcome = normalizeAiEnvelope(aiResponse);
  if (outcome.payload === null) {
    console.warn(
      `[ai] fallback reason=envelope-${outcome.strategy} model=${AI_MODEL_ID} fingerprint=${outcome.fingerprint ?? "n/a"}`,
    );
    return fallbackResult();
  }
  const payload = outcome.payload;

  // Step 4 — filter hallucinated IDs. The LLM may invent ids; we drop any
  // that don't correspond to an active mission.
  const validIds = new Set(activeMissions.map((m) => m.id));
  const cleaned: AiPayload = {
    missionIds: payload.missionIds.filter((id) => validIds.has(id)),
    reason: payload.reason,
  };

  // Step 5 — cache + return. Only happy-path results are cached; fallbacks
  // returned above bypass this block intentionally so the next call retries.
  await env.CACHE.put(key, JSON.stringify(cleaned), {
    expirationTtl: RECOMMENDATIONS_CACHE_TTL_SECONDS,
  });
  return { ...cleaned, cached: false };
}
