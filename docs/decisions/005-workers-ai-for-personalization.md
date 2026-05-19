---
title: ADR-005 — Workers AI for recommendation personalization
status: Accepted
date: 2026-05-19
deciders: Bosso (@ilGentEAcutoO)
---

# ADR-005: Workers AI for recommendation personalization

## Context

QuestKit's `GET /v1/recommendations` endpoint returns up to three missions
the user is most likely to engage with next, plus a short encouraging
sentence ("You've been on a streak — try…"). The signal is the user's
recent event stream (last 50 events) and their active mission catalog. The
output is a list of mission IDs and a single warm sentence rendered in the
demo's `RecommendedMissions` panel.

Three design constraints applied:

1. **No user-vector storage.** The portfolio piece is at v0.1; building an
   embeddings pipeline plus a vector database adds infrastructure that
   doesn't pay for itself at this scale.
2. **Cloudflare-only.** Following ADR-001, the inference must run on a
   Cloudflare primitive — no OpenAI, no Anthropic, no third-party LLM API.
3. **Low latency, low cost, no data exfiltration.** Recommendations are a
   non-critical UI panel; if they take 3 s the user is fine, but they
   shouldn't take 30 s, and they shouldn't ship user data off-platform.

## Decision

The recommender is implemented in
[workers/api/src/services/ai.ts](../../workers/api/src/services/ai.ts) and
calls Cloudflare Workers AI via the `env.AI` binding. The model is
`@cf/meta/llama-3.1-8b-instruct-fast` — locked by plan amendment A8 because
the base `@cf/meta/llama-3.1-8b-instruct` deprecates on 2026-05-30. The
`-fast` variant is the actively-maintained successor with the same prompt
shape and token economics.

The service is structured as a pure function over `Pick<Env, "AI" | "CACHE">`,
which both decouples it from Hono and unlocks the testing pattern in
ADR-006. The pipeline is: (1) check KV cache at key `rec:${userId}` with a
1-hour TTL; on hit, return immediately; (2) build the prompt as a system
message (verbatim from `SYSTEM_PROMPT`) plus a user message containing only
structured event summaries (event name + count, mission id + criteria —
**never** event payloads); (3) call `env.AI.run(AI_MODEL_ID, { messages,
max_tokens: 200, response_format: { type: 'json_object' } })`; (4) parse the
response, validating shape strictly and falling through to an
`AiResponseError` on malformed JSON; (5) filter hallucinated mission IDs by
intersecting against `activeMissions`; (6) cache the cleaned result for
1 h and return it.

The route handler
([workers/api/src/routes/recommendations.ts](../../workers/api/src/routes/recommendations.ts))
short-circuits with an empty result when the user has no active missions —
saving an inference and matching the brief.

## Consequences

### Positive

- **No user vector store.** The structured prompt contains everything the
  LLM needs to decide; we don't keep per-user embeddings.
- **First-party platform binding.** `env.AI.run` has no external HTTP, no
  third-party key, no cross-provider latency.
- **Workers AI free tier covers initial scale.** Cloudflare provides a
  monthly free tier on Workers AI inference that comfortably covers a
  portfolio-stage demo.
- **Strict prompt-injection guard.** Event **payloads** are never
  serialised into the user message — only structured event names and counts
  reach the model. This is asserted by a security test
  ([workers/api/test/ai.service.test.ts](../../workers/api/test/ai.service.test.ts)
  → "does NOT include event payload VALUES in the user message").
- **Hallucination tolerance.** The filter step drops any mission ID the LLM
  invents. A misbehaving model degrades the recommendation, not the
  endpoint's correctness contract.
- **1-hour KV cache.** Repeated recommendation calls for the same user
  collapse to one inference per hour, smoothing latency and cost.

### Negative

- **Latency.** Workers AI inference for an 8B model averages 1–3 s. This is
  acceptable for a panel that loads alongside the page and shows a skeleton
  state, but unacceptable for any in-flight user interaction. The endpoint
  is deliberately not on a critical path.
- **No eval rigor.** v0.1 does not measure recommendation quality. The
  output is "pattern-match the user's most-fired event against the
  mission's criteria event" plus a warm sentence — useful as a
  demonstration, not as a recommender system. A future v0.2 would add a
  click-through eval and possibly a heuristic baseline to compare against.
- **No local emulator.** Workers AI bindings are always remote-proxied
  even in `wrangler dev`. This forced the test-architecture decision in
  ADR-006: AI-touching code is tested at the service layer with a
  hand-rolled `Pick<Env, "AI" | "CACHE">` stub, not through
  `cloudflare:test`'s pool-workers env.
- **Model deprecation risk.** Plan amendment A8 already had to swap models
  once. Pinning `AI_MODEL_ID` as a single constant means future swaps are
  one-line changes, but the schedule is governed by Cloudflare's deprecation
  cadence, not ours.

### Neutral

- **JSON-only response format.** The system prompt instructs the model to
  return JSON only, and the call uses `response_format: { type:
'json_object' }`. The service also falls back to scanning for the first
  `{...}` block in case the model prefixes prose despite instructions —
  defensive parsing rather than blind trust.

## Alternatives considered

### 1. OpenAI API (GPT-4o or GPT-4o-mini)

**Pros**: Higher-quality output. Mature API. Familiar to most engineers.
**Cons**: Off-Cloudflare (breaks ADR-001). Requires an API key that becomes
a secret to manage, rotate, and protect from public-repo leak. Paid per
token from token zero.
**Why rejected**: Hard constraint against off-Cloudflare runtime
dependencies, plus the cost-management overhead.

### 2. Manual ranking heuristic

**Pros**: Deterministic, zero inference cost, no model deprecation,
testable end-to-end without stubs.
**Cons**: The job description explicitly mentioned "AI-powered
personalization" as a desirable competency. A hand-coded heuristic doesn't
demonstrate the LLM-integration skill the JD was asking about. The output
would also be less personable — no warm sentence.
**Why rejected**: Defeats the demonstration value of the endpoint. A
heuristic could be added as a fallback under the LLM path (return ranking
when `env.AI.run` throws) — that's an option for v0.2.

### 3. Vector database + embeddings (Vectorize, Pinecone, Weaviate)

**Pros**: Scales to large mission catalogs and large user histories.
Returns semantically-similar missions even without an explicit event-name
match. Industry-standard pattern.
**Cons**: At v0.1 scale (6 seeded missions, ≤50 recent events per user)
the embeddings layer is pure overhead. Requires building an indexing
pipeline, a per-user vector storage policy, and a similarity-search cost
model. Substantially more code to maintain.
**Why rejected**: Overkill for the demo's scale. Listed in the v0.2
roadmap as the natural upgrade path if the catalog grows past a hundred
missions.

## References

- [Plan amendment A8 — `@cf/meta/llama-3.1-8b-instruct-fast`](../../instruction/work/plan.md#3-spec-amendments)
- [Plan §2.5 — `AI` binding](../../instruction/work/plan.md#25-bindings-used-by-questkit-worker-api)
- [Plan §5 — Security: AI prompt injection](../../instruction/work/plan.md#5-security-considerations)
- [workers/api/src/services/ai.ts](../../workers/api/src/services/ai.ts)
- [workers/api/src/routes/recommendations.ts](../../workers/api/src/routes/recommendations.ts)
- [Cloudflare Workers AI — Llama 3.1 8B Instruct Fast](https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fast/)
