# QuestKit — Phase 9 / v0.1.5 — Test Report

> Last updated: 2026-05-21 11:55

---

## TASK-006 — B6 verification spike ("AI picks unavailable right now.")

### Verdict

**ESCALATE — confirmed P0 production bug. 5/5 (100%) fallback rate on fresh users in prod.**

This is NOT the TASK-002 (Phase 8 / v0.1.4) fallback working as designed. The
graceful-fallback path is correctly translating an upstream AI failure into a
200-with-`fallback:true` response so the UI does not see a red 502 — but the
underlying AI call is failing on EVERY single request, not occasionally. The
user's bug report is real: the "AI picks" panel is permanently broken for
demo users in prod.

### Method

1. Minted a JWT for `demo-user` via `POST https://questkit.jairukchan.com/api/token` — succeeded.
2. With that JWT, called `GET https://api.questkit.jairukchan.com/v1/recommendations` 5 times.
   - First batch (same user): all 5 returned the empty short-circuit response
     (`reason: "Start firing events to unlock personalised missions."`,
     no `fallback` field) because the user had no active missions yet. This
     bypasses the AI entirely — see `recommendations.ts:120-128`. Inconclusive,
     so I re-ran with a populated mission state.
3. Created **5 fresh users** (`demo-user-rec-1` … `demo-user-rec-5`). For each:
   1. Mint JWT via `/api/token`.
   2. Fire one `video.watched` event with `{genre:"documentary",durationMin:25}`
      → server returns `missionsUpdated:["mis_stream_daily_watch_1","mis_stream_documentary_3","mis_stream_longform_week"]`. Mission state populated.
   3. Call `GET /v1/recommendations`.
4. Tallied the result.

### Results

| #   | User              | Response (compact)                                                                            |
| --- | ----------------- | --------------------------------------------------------------------------------------------- |
| 1   | `demo-user-rec-1` | `{missionIds:[],reason:"AI picks unavailable right now.",cached:false,count:0,fallback:true}` |
| 2   | `demo-user-rec-2` | `{missionIds:[],reason:"AI picks unavailable right now.",cached:false,count:0,fallback:true}` |
| 3   | `demo-user-rec-3` | `{missionIds:[],reason:"AI picks unavailable right now.",cached:false,count:0,fallback:true}` |
| 4   | `demo-user-rec-4` | `{missionIds:[],reason:"AI picks unavailable right now.",cached:false,count:0,fallback:true}` |
| 5   | `demo-user-rec-5` | `{missionIds:[],reason:"AI picks unavailable right now.",cached:false,count:0,fallback:true}` |

**Fallback rate: 5/5 = 100%.** Far above the ≥80% escalation threshold.

### Hypothesis (NOT verified — observability needs to land first)

Three possible root causes, in order of likelihood:

1. **Workers AI binding is throwing.** Most likely — the model id is locked at
   `@cf/meta/llama-3.1-8b-instruct-fast` (amendment A8, after the base model
   was deprecated 2026-05-30). If the `-fast` variant has been deprecated /
   renamed / restricted by Cloudflare since then, every `env.AI.run(AI_MODEL_ID, …)`
   call throws → `recommendations.ts:145` catches → returns fallback. The
   route-level `console.warn("[recommendations] ai binding failure, falling back", err)`
   should already be firing every request; an operator can confirm via
   `wrangler tail`.
2. **Workers AI runtime returned a 4th envelope shape** none of the three
   accepted strategies match → `normalizeAiEnvelope` returns null → fallback.
3. **`response_format: { type: "json_object" }` is being silently dropped** by
   the runtime and the model emits prose around the JSON that `tryParseJson`'s
   substring extractor still fails on.

### What I shipped (observability instrumentation)

`workers/api/src/services/ai.ts` — distinct, one-line, value-stripped warns
per fallback branch so the next `wrangler tail` window tells us exactly which
hypothesis is correct, without redeploying.

Concrete changes:

1. `normalizeAiEnvelope` now returns `EnvelopeOutcome` (`{ payload, strategy,
fingerprint? }`) instead of `AiPayload | null`. On failure the outcome
   carries:
   - `strategy: "no-strategy-matched" | "not-an-object"` — distinguishes
     "runtime returned a thing that wasn't even an object" from "runtime
     returned an object but no envelope strategy validated it".
   - `fingerprint` — a bounded (~200 char) structural summary of the raw
     response: top-level keys + their value types/lengths. **Values are
     never logged** (host-supplied / LLM-generated data may contain PII or
     prompt-injection attempts; we deliberately strip them).
2. `recommendMissions` now wraps `env.AI.run(...)` in a try/catch. On throw
   it emits `[ai] fallback reason=ai-run-threw model=… errName=… errMsg=<truncated>`
   and rethrows so the route's existing outer catch still surfaces a 200
   fallback. No behaviour change for clients — only an extra log line.
3. The single existing warn at the old `ai.ts:307` ("response did not match
   any known envelope; falling back") is replaced with
   `[ai] fallback reason=envelope-<strategy> model=<id> fingerprint=<short>`
   so an operator can grep for `[ai] fallback reason=` and see all fallback
   firings with a distinct `reason=` tag per branch.

No new endpoints, no new env bindings, no new dependencies. Strictly
observability — public `recommendMissions` API and `RecommendationsResult`
shape unchanged. All 12 existing `ai.service.test.ts` tests still pass;
typecheck + lint both clean.

### Next steps for the operator (user-side)

Once the next deploy lands (TASK-008 v0.1.5 release will carry these
changes), run:

```pwsh
# Terminal 1 — watch the worker logs
wrangler tail --name questkit-worker-api --format pretty

# Terminal 2 — repeat the 5-user verification:
#   For each of u1..u5: mint /api/token, POST a video.watched event, then
#   GET /v1/recommendations. Each GET will trigger exactly one fallback log
#   line in Terminal 1 with a `reason=` tag identifying the branch.
```

Expected tail output per failed request — one of these three lines:

- `[ai] fallback reason=ai-run-threw model=@cf/meta/llama-3.1-8b-instruct-fast errName=… errMsg=…`
  → Hypothesis 1. Action: pick a replacement model from the current
  `cloudflare/workers-ai` model catalog (check Cloudflare dashboard or
  `https://developers.cloudflare.com/workers-ai/models/`), update
  `AI_MODEL_ID` in `ai.ts:55`, redeploy. Phase 10 plan amendment.
- `[ai] fallback reason=envelope-no-strategy-matched model=… fingerprint={…}`
  → Hypothesis 2. The `fingerprint` field tells us the new runtime envelope
  shape — add a 4th strategy to `normalizeAiEnvelope`. Phase 10 patch task.
- `[ai] fallback reason=envelope-not-an-object model=… fingerprint=…`
  → Variant of 2. Runtime returned a string/number/null at the top level.
  Same fix path.

Plus the route-level warn (`recommendations.ts:146`,
`[recommendations] ai binding failure, falling back <err>`) will fire when
hypothesis 1 lands the throw at the route boundary — that line is already
in the codebase from Phase 8.

### Files changed

- `workers/api/src/services/ai.ts` — `EnvelopeOutcome` + `envelopeFingerprint`
  helpers; `normalizeAiEnvelope` signature change (private → callers updated
  in the same file); `recommendMissions` adds try/catch around `env.AI.run`
  and per-branch warn. ~50 net lines added, all observability/comments.

### Why this is escalate not non-bug

Plan §"TASK-006 acceptance criteria": "rate < 20% → close as non-bug; rate
≥ 80% → escalate P0, add to Phase 10 backlog." Observed rate is 100% —
clearly above 80%. The fact that the fallback UX is correct (no red error
banner, no broken page) does NOT make the underlying AI outage a non-bug:
demo visitors who click the "AI picks" button will see "AI picks
unavailable right now." 100% of the time, which is the whole point of the
B6 user report.

### Recommended Phase 10 backlog entry

> **B6 follow-up (P0)** — AI recommendations endpoint is failing 100% of
> the time in prod. Observability landed in v0.1.5; operator should run
> `wrangler tail` against the deployed worker to identify which branch
> (`ai-run-threw` vs `envelope-no-strategy-matched`) is firing, then:
>
> - If model is deprecated → swap to a current Workers-AI text-generation
>   model + redeploy.
> - If runtime envelope changed → add a 4th strategy to `normalizeAiEnvelope`.
>   Re-run the 5-user verification after the fix. Acceptance: rate < 20%.
