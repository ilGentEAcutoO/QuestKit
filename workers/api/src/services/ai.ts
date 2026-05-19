/**
 * Workers-AI personalisation service (TASK-017).
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
 *     A malformed response (e.g. non-JSON, missing fields) throws
 *     `AiResponseError` which the route maps to 502.
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
 * Thrown when the AI returned a response we cannot parse / validate. Route
 * handlers map this to HTTP 502.
 */
export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

/** Result returned to the route layer. */
export interface RecommendationsResult {
  missionIds: string[];
  reason: string;
  /** True when served from KV cache (no AI call this request). */
  cached: boolean;
}

/**
 * Internal — shape the AI must produce inside its JSON-only response.
 */
interface AiPayload {
  missionIds: string[];
  reason: string;
}

/**
 * Validate the parsed JSON shape. Returns the typed payload on success,
 * throws `AiResponseError` on any structural defect.
 */
function validateAiPayload(raw: unknown): AiPayload {
  if (typeof raw !== "object" || raw === null) {
    throw new AiResponseError("ai response is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const missionIds = obj.missionIds;
  const reason = obj.reason;

  if (!Array.isArray(missionIds)) {
    throw new AiResponseError("ai response missionIds is not an array");
  }
  for (const id of missionIds) {
    if (typeof id !== "string") {
      throw new AiResponseError("ai response missionIds contains non-string");
    }
  }
  if (typeof reason !== "string") {
    throw new AiResponseError("ai response reason is not a string");
  }
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
 * Cache MISS path: builds the prompt, calls `env.AI.run(...)`, validates the
 *   response shape, filters hallucinated IDs, caches the result for 1h,
 *   returns `{ ...result, cached: false }`.
 *
 * @throws AiResponseError when the LLM returns an unparseable / malformed payload.
 * @throws Whatever `env.AI.run` throws on its own (route maps to 503).
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

  // Step 2 — build the prompt + call AI.
  const userMessage = buildUserMessage(recentEvents, activeMissions);
  const aiResponse = await env.AI.run(AI_MODEL_ID, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    max_tokens: 200,
    response_format: { type: "json_object" },
  });

  // Step 3 — extract the textual `.response` field from the binding result.
  if (
    typeof aiResponse !== "object" ||
    aiResponse === null ||
    typeof (aiResponse as { response?: unknown }).response !== "string"
  ) {
    throw new AiResponseError("ai response has no .response string");
  }
  const responseText = (aiResponse as { response: string }).response;

  const parsed = tryParseJson(responseText);
  if (parsed === null) {
    throw new AiResponseError("ai response did not contain parseable JSON");
  }
  const payload = validateAiPayload(parsed);

  // Step 4 — filter hallucinated IDs. The LLM may invent ids; we drop any
  // that don't correspond to an active mission.
  const validIds = new Set(activeMissions.map((m) => m.id));
  const cleaned: AiPayload = {
    missionIds: payload.missionIds.filter((id) => validIds.has(id)),
    reason: payload.reason,
  };

  // Step 5 — cache + return.
  await env.CACHE.put(key, JSON.stringify(cleaned), {
    expirationTtl: RECOMMENDATIONS_CACHE_TTL_SECONDS,
  });
  return { ...cleaned, cached: false };
}
