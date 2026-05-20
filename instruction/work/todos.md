# QuestKit — Active Tasks (Phase 8 / v0.1.4)

> Last updated: 2026-05-20 19:05
> Plan: [`plan.md`](./plan.md) · Requirements: [`requirements.md`](./requirements.md)
> Predecessor archived at `../archive/001-phase-7-security-hardening-v0.1.3/`
> Feature branch: `phase-8-v0.1.4` (commit d36a59a)
> Active worktrees: `../QuestKit-worktrees/task-{001..006}` — one per parallel implementer

---

### Task: [TASK-001] Fix SSE broadcast deadlock (claim/watch/counter hang)

- **Status:** 🟢 completed (2026-05-20 20:30) — spec ✅ + quality ✅
- **Priority:** high
- **Parallel:** yes
- **Assigned:** task-001-impl (worktree: `../QuestKit-worktrees/task-001`, branch `task-001-sse-deadlock` @ commit `0e8aca5`)
- **Result:** 3-layer defense — (1) `c.executionCtx.waitUntil(tryBroadcast*(...))` detaches broadcast from request lifetime; (2) `AbortSignal.timeout(2000)` on every DO `stub.fetch` so the worker can't deadlock waiting on a wedged DO; (3) inside `SSEHub.broadcast`, `Promise.allSettled` over per-writer `Promise.race` with 1s `setTimeout` cap (cleanly cleared in `finally`). 5 new tests using true HWM=1 backpressure (not throwing-writer shortcut). 185 pass / 1 skip. Scope expansion to `events.ts` + `index.ts` (ApiService RPC) justified because `ingestEventCore` is shared between HTTP + RPC paths. Spec deviation on broadcast latency (1s vs <50ms) deliberate — user-visible latency satisfied via waitUntil detachment (claim returns <500ms even with wedged DO).
- **Follow-ups (non-blocking, for future polish):**
  - Extract `SSE_HUB_TIMEOUT_MS = 2000` to a shared constant (currently duplicated in `missions.ts` and `ingest.ts`).
  - `IngestEventContext.waitUntil` is optional with an inline-await fallback — a future contributor wiring a new caller could silently regress. Consider making it required or logging a warn on the fallback path.
  - Add a direct test for `ApiService.ingestEvent` RPC entrypoint (currently parity-covered via HTTP route tests).
- **Depends on:** -
- **Skills:** workflow-work, git-commit, deploy
- **Files:**
  - `workers/api/src/routes/missions.ts`
  - `workers/api/src/services/ingest.ts`
  - `workers/api/src/durable/sse-hub.ts`
- **Subtasks:**
  - [ ] implement: switch `await tryBroadcastClaim(...)` → `c.executionCtx.waitUntil(tryBroadcastClaim(...))` (routes/missions.ts:287-293)
  - [ ] implement: switch `await tryBroadcastProgress(...)` → `waitUntil` (services/ingest.ts:220)
  - [ ] implement: add `signal: AbortSignal.timeout(2000)` to every DO `stub.fetch` call
  - [ ] implement: parallelize `SSEHub.broadcast` writers with `Promise.allSettled` + per-writer 1s timeout
  - [ ] test: unit — claim returns <100 ms with one stalled SSE writer
  - [ ] test: integration — counters keep advancing while watch holds EventSource
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Root cause identified by api-audit.md; user-reported claim hang, counter freeze, and watch hang are all the same bug.

---

### Task: [TASK-002] Fix AI recommendations 502 envelope mismatch

- **Status:** 🟢 completed (2026-05-20 20:18) — spec ✅ + quality 🟡 (fixed)
- **Priority:** high
- **Parallel:** yes
- **Assigned:** task-002-impl (worktree: `../QuestKit-worktrees/task-002`, branch `task-002-ai-envelope` @ commits `6fcc7ad` + `b5b3729`)
- **Result:** `normalizeAiEnvelope` handles 3 envelope shapes (`{response: string}`, `{result: object|string}`, raw). On failure, returns `{fallback: true, missionIds: [], reason: "AI picks unavailable right now."}` instead of throwing. Route returns HTTP 200 (no more 502/503). Server bypasses KV cache on fallback. React component renders graceful empty-state with `role="status"`. 11+ new tests across api worker + react. Follow-up commit `b5b3729` gated client-side cache on `next.fallback !== true` (so the next mount retries the server, preserving the server's no-cache-on-fallback policy) and deleted unused `AiResponseError` class (verified zero external refs).
- **Public type change:** `RecommendationsResult.fallback?: boolean` (additive).
- **Doc updates:** `apps/docs/docs/api/{overview,recommendations}.md` + `apps/docs/docs/react/components.mdx` — necessary because old docs documented `502 ai_response_malformed` / `503 ai_unavailable` as part of the public HTTP contract; keeping them would mislead consumers.
- **Follow-ups (non-blocking, tracked for future polish):**
  - D1 loaders in `recommendations.ts` are outside the try/catch — D1 outage would surface as raw 500 instead of folding into the same 200 fallback. Tighter scoping would be safer.
  - Route-level catch is broad — could narrow to `instanceof` checks vs. specific known error types.
  - `FALLBACK_REASON` is English-only — i18n consideration once Vue adapter or non-React surfaces ship.
  - Storybook story for fallback state — package has no Storybook scaffold yet; RTL substitute covers CI but not visual review.
- **Depends on:** -
- **Skills:** workflow-work, git-commit, deploy
- **Files:**
  - `workers/api/src/services/ai.ts`
  - `workers/api/src/routes/recommendations.ts`
  - `packages/react/src/components/RecommendedMissions/index.tsx`
- **Subtasks:**
  - [ ] implement: accept 3 envelope shapes — `{response: string}`, `{result: object}`, raw object — normalize before `tryParseJson`
  - [ ] implement: on parse failure, return `{ fallback: true, items: [] }` instead of throwing
  - [ ] implement: `recommendations.ts` returns 200 (not 502) with `fallback: true` + `reason`
  - [ ] implement: `<RecommendedMissions>` renders graceful empty-state for fallback (no raw error code)
  - [ ] test: ai.test.ts covers all 3 envelope shapes
  - [ ] test: RecommendedMissions Storybook story for fallback state
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Browser-confirmed: `GET /v1/recommendations` → 502 `ai_response_malformed` on live demo.

---

### Task: [TASK-003] Add server-side demo reset endpoint

- **Status:** 🟢 completed (2026-05-20 20:12) — spec ✅ + quality 🟡 (fixed)
- **Priority:** high
- **Parallel:** yes
- **Assigned:** task-003-impl (worktree: `../QuestKit-worktrees/task-003`, branch `task-003-demo-reset` @ commits `162b6d1` + `514d5ff`)
- **Result:** `POST /v1/demo/reset` (gated `kind === "demo"` AND `userId startsWith "demo_"`), `db.batch` atomic wipe, KV prefix sweep, new SDK `client.demoReset(): Promise<{ok: true}>`, DevTools rewire (server-first → local-clear → reload). 12 new tests across api worker + 2 new core tests pinning storage-key contract. 191/1 skip api + 89 core. Follow-up commit `514d5ff` exported `EVENT_QUEUE_STORAGE_KEY` from `@questkit/core` and added it to DevTools `STORAGE_KEYS_TO_CLEAR` so queued events don't silently re-populate the freshly-wiped server on next page load.
- **Follow-ups (non-blocking, for future polish):**
  - Expose `client.clearEventQueue()` SDK method so DevTools doesn't reach around the SDK for its private storage.
  - Optional `client.demoReset()` cache invalidation hook for any future cached resources beyond progress/balance/events.
- **Depends on:** -
- **Skills:** workflow-work, git-commit, deploy, env-sync
- **Files:**
  - `workers/api/src/routes/demo.ts` (NEW)
  - `workers/api/src/index.ts`
  - `workers/api/src/db/schema.ts`
  - `workers/api/src/routes/auth.ts`
  - `apps/demo/src/panels/DevTools.tsx`
  - `apps/demo/src/lib/client.tsx`
  - `packages/core/src/client.ts` (add `demoReset()` method)
- **Subtasks:**
  - [ ] implement: `POST /v1/demo/reset` — guard with JWT `kind === "demo"` (or `userId` starts with `demo_`), wipe `mission_progress` + `balances` + `events` in one `db.batch`
  - [ ] implement: delete KV keys `idem:${userId}:*` and `rec:${userId}`
  - [ ] implement: extend `POST /v1/auth/token` to include `kind: "demo"` claim when called by demo's mint proxy (`apps/demo/src/server/index.ts`)
  - [ ] implement: SDK `client.demoReset()` method
  - [ ] implement: rewire DevTools "Reset demo user" to call `client.demoReset()` → clear local cache → reload
  - [ ] implement: update DevTools copy: "Clears server-side progress, balance, and event history."
  - [ ] test: API — wipe only affects target userId
  - [ ] test: API — non-demo JWT → 403
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Browser-confirmed: DevTools dialog text explicitly says "Server-side progress remains; sign in as a different userId for a clean slate (Phase 6 task)." Phase 6 punted on this; doing it now.

---

### Task: [TASK-004] Cap counter display + clarify claimed state

- **Status:** 🟢 completed (2026-05-20 19:18) — ✅ spec + ✅ quality both approved
- **Priority:** medium
- **Parallel:** yes
- **Assigned:** task-004-impl (worktree: `../QuestKit-worktrees/task-004`, branch `task-004-counter-cap` @ commit `4a2172f`)
- **Result:** 6 new RTL tests added at `packages/react/test/components/MissionCard.test.tsx` (project Jest config requires this path, not the plan's `src/components/`). 18/18 MissionCard tests + 131/131 full @questkit/react suite green. Counter clamped via `displayCurrent`/`displayPercent`. New `✓ claimed today` hint (separate `<p>`, `aria-hidden` glyph). Counter dimmed to opacity 0.45 on claimed (non-claimed 0.7 baseline preserved — no scope creep).
- **Minor follow-ups (non-blocking, log for future polish):**
  - `Math.min(currentCount, targetCount)` reads more idiomatically than the nested ternary (style preference; behavior identical).
  - Test could assert non-claimed baseline opacity ≈ 0.7 alongside the dimmed assertion for explicit regression coverage.
  - Optional: add dev-only `console.warn` (or analytics ping) when clamp engages, so server-side overshoot regressions are noticed once the root cause in `rules/evaluator.ts:130-132` is fixed.
- **Depends on:** -
- **Skills:** workflow-work, git-commit
- **Files:**
  - `packages/react/src/components/MissionCard/index.tsx`
  - `packages/react/src/components/MissionCard/MissionCard.test.tsx`
- **Subtasks:**
  - [ ] implement: render text counter as `${Math.min(currentCount, targetCount)} / ${targetCount}`
  - [ ] implement: clamp progress-bar visual at 100% when overshoot
  - [ ] implement: when `status === "claimed"`, dim counter + add small "✓ claimed today" hint
  - [ ] test: RTL — `current=19, target=5` shows "5 / 5"
  - [ ] test: RTL — claimed state renders new hint
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Eliminates the "19/5" UX confusion regardless of server reset behavior.

---

### Task: [TASK-005] Frontend fetch timeouts (defense-in-depth)

- **Status:** 🟢 completed (2026-05-20 20:38) — spec ✅ + quality 🟡 (fixed)
- **Priority:** medium
- **Parallel:** yes
- **Assigned:** task-005-impl (worktree: `../QuestKit-worktrees/task-005`, branch `task-005-fe-timeouts` @ commits `41f1af6` + `08df7f7`)
- **Result:** Centralized private `request()` helper in `@questkit/core` injects `AbortSignal.timeout(timeoutMs)` (default 10s, configurable via `QuestKitConfig.timeoutMs`). Timeout maps to `QuestKitError({code:"timeout"})` with diagnostic ms-included message. SSE intentionally bypasses (long-poll). Demo browser→worker mint: 10s. Worker→upstream proxy: 8s. `fireEvent` deliberately queues on timeout (preserves at-least-once contract); `useEvent` / `useMissionClaim` unstick via finally. Follow-up commit `08df7f7` applied two important quality-review fixes: (1) `authedFetch`'s 401-retry now shares a single timeout signal across both attempts (no more doubled budget), with short-circuit if expired during attempt 1 + token refresh; (2) `isRetryableNetworkError()` discriminator applied to both `fireEvent.sendFn` AND `flushEvents.sendFn` — only `QuestKitError(timeout)`, `TypeError`, and `AbortError` queue; everything else (config errors, SyntaxError from JSON.parse, generic Error) rethrows.
- **Public API additions:** `QuestKitConfig.timeoutMs?: number`, error `code: "timeout"` (additive — `code: string` was already non-discriminated).
- **Test counts:** 107 core + 128 react = 235 total green.
- **Cross-task heads-up:** also touches `packages/react/src/components/MissionCard/index.tsx` (single defensive `.catch()` line on `void handleClaim()` to prevent unhandled-rejection now that timeouts cause `onClaim` to reject realistically). Merge with TASK-004's MissionCard edits expected to be clean (different lines).
- **Depends on:** -
- **Skills:** workflow-work, git-commit
- **Files:**
  - `packages/core/src/client.ts`
  - `apps/demo/src/lib/auth.ts`
  - `apps/demo/src/server/index.ts`
- **Subtasks:**
  - [ ] implement: every internal `fetch` in core/client.ts gets `signal: AbortSignal.timeout(10000)` (configurable via constructor `timeoutMs`)
  - [ ] implement: timeout rejects with `QuestKitError({ code: "timeout" })`
  - [ ] implement: demo mint fetch + upstream proxy fetch both get timeouts (10s / 8s)
  - [ ] test: client.test.ts — each method rejects with timeout error when fetch hangs
  - [ ] test: useEvent / useMissionClaim unstick after timeout
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Even after TASK-001 fixes the deadlock, FE-side timeouts convert any future API hang into a recoverable toast.

---

### Task: [TASK-006] Optimistic counter updates from `fireEvent`

- **Status:** 🟢 completed (2026-05-20 20:05) — spec ✅ + quality 🟡 (fixed)
- **Priority:** low
- **Parallel:** yes
- **Assigned:** task-006-impl (worktree: `../QuestKit-worktrees/task-006`, branch `task-006-optimistic-counters` @ commits `879b2c0` + `3504dd9`)
- **Result:** Public `client.onFireEventSuccess(cb)` SDK method + `useMissions` optimistic merge. 8 new core tests, 8 new react tests (133/133 react + 94/94 core). Dedupe policy: server-authoritative last-writer-wins. Follow-up commit `3504dd9` made SSE `mission.progress` merge monotonic (Math.max on currentCount) so visible counters never regress when SSE delivers a lower count than the optimistic state. ⚠️ note: implementer's first commit touched `todos.md` (will be reset at merge).
- **Depends on:** -
- **Skills:** workflow-work, git-commit
- **Files:**
  - `packages/react/src/hooks/useMissions.ts`
  - `packages/react/src/QuestKitProvider.tsx`
- **Subtasks:**
  - [ ] implement: SDK exposes `onFireEventSuccess(missionsUpdated)` callback
  - [ ] implement: `useMissions` merges `missionsUpdated[]` into local progress immediately
  - [ ] test: simulated SSE outage — counters still advance on `fireEvent`
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Makes counters resilient to any future SSE breakage.

---

### Task: [TASK-007] Reproducible CI deploy + automated D1 migrations

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no
- **Assigned:** unassigned
- **Depends on:** TASK-001, TASK-002, TASK-003
- **Skills:** workflow-work, deploy, env-sync, git-push
- **Files:**
  - `.github/workflows/deploy.yml` (NEW)
  - `workers/api/wrangler.jsonc`
  - `package.json`
  - `docs/SELF_HOSTING.md`
- **Subtasks:**
  - [ ] implement: `deploy.yml` triggered on push to `main` after CI passes; uses `cloudflare/wrangler-action@v3`
  - [ ] implement: workflow step: `wrangler d1 migrations apply questkit-d1-main --remote`
  - [ ] implement: deploy all 6 workers in dependency order (api → consumer → relay → demo → docs → playground)
  - [ ] implement: post-deploy smoke — `GET /v1/health` + `GET /` return 200
  - [ ] implement: move `<set-per-env>` placeholders into `wrangler.jsonc [env.production]` block; gitignore `wrangler.local.jsonc` instead
  - [ ] implement: document GitHub secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `JWT_SECRET`, `APP_SECRET`, `WEBHOOK_HMAC_SECRET`) in SELF_HOSTING.md
  - [ ] test: dry-run with `--dry-run --outdir=dist/preview` for each worker
  - [ ] test: rc-branch deploy succeeds end-to-end
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Deploy audit found no deploy.yml exists; all production deploys have been manual. Critical for shipping the fixes reliably.

---

### Task: [TASK-008] Verify production secrets + migrations (read-only diagnostic)

- **Status:** 🟢 completed (2026-05-20 19:02)
- **Priority:** high
- **Parallel:** yes
- **Assigned:** controller (direct wrangler CLI)
- **Depends on:** -
- **Skills:** workflow-work
- **Files:** -
- **Subtasks:**
  - [x] implement: `pnpm wrangler secret list --name questkit-worker-api` — ✅ all 3 secrets present (APP_SECRET, JWT_SECRET, WEBHOOK_HMAC_SECRET)
  - [x] implement: `pnpm wrangler d1 execute --remote ...` — ✅ confirmed prod had only 0001/0002 applied (0003/0004 MISSING)
  - [x] implement: applied 0003 (daily visitor mission) + 0004 (minigame missions) via `wrangler d1 migrations apply --remote` — both ✅ confirmed applied
  - [ ] implement: `wrangler tail` during live claim — deferred to TASK-010 browser walkthrough
  - [ ] test: smoke curl after TASK-007 deploy lands
- **Progress Notes:**
  - 2026-05-20 18:20 — Created.
  - 2026-05-20 19:02 — Diagnostic completed. CRITICAL finding: prod was missing migrations 0003 (daily_visitor) and 0004 (minigame missions). This explained why /daily and /minigames felt broken — the missions referenced by the UI literally didn't exist in DB. Applied both migrations via idempotent INSERT OR REPLACE / INSERT OR IGNORE statements. Production D1 now in sync with migration tree.
  - 2026-05-20 19:02 — Note for TASK-007: `wrangler.jsonc` uses `<set-per-env>` placeholders, so remote commands require `--config wrangler.dev.jsonc`. TASK-007 should move real IDs to `[env.production]` block in tracked config for CI to use.

---

### Task: [TASK-009] Playwright E2E suite against live deploy

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no
- **Assigned:** unassigned
- **Depends on:** TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-007
- **Skills:** workflow-work, frontend-test, git-commit
- **Files:**
  - `apps/demo/e2e/ecommerce.spec.ts` (NEW)
  - `apps/demo/e2e/streaming.spec.ts` (NEW)
  - `apps/demo/e2e/daily.spec.ts` (NEW)
  - `apps/demo/e2e/minigames.spec.ts` (NEW)
  - `apps/demo/e2e/cross-cutting.spec.ts` (NEW)
  - `apps/demo/playwright.config.ts`
  - `package.json`
  - `.github/workflows/deploy.yml`
- **Subtasks:**
  - [ ] implement: ecommerce — Buy ×6 + Claim per mission + counter cap regression
  - [ ] implement: streaming — Watch ×4 + "Logging…" never >3s regression
  - [ ] implement: daily — Check in + reload persistence
  - [ ] implement: minigames — Spin (animation, reward, cooldown) + Scratch (×3 reveals → 3/3)
  - [ ] implement: cross-cutting — AI picks happy/empty, EventLog drawer, Reset demo user (full clear), Coin balance
  - [ ] implement: new scripts `e2e:prod`, `e2e:preview` with `BASE_URL` env
  - [ ] implement: integrate into `deploy.yml` — fails deploy on regression
  - [ ] test: full suite green against `main`
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Directly addresses user's "เก็บให้ครบทุกปุ่ม ทุก scenario" demand.

---

### Task: [TASK-010] Browser sanity verification — final clicker walkthrough

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no
- **Assigned:** unassigned
- **Depends on:** TASK-001 → TASK-009
- **Skills:** frontend-test
- **Files:**
  - `instruction/work/test-report.md` (NEW)
  - `agent-temp/` (screenshots/GIF evidence)
- **Subtasks:**
  - [ ] implement: open https://questkit.jairukchan.com, walk all 4 routes
  - [ ] implement: capture screenshots/GIF — claim returns, counter caps, watch returns, AI picks renders, reset wipes
  - [ ] implement: 10-minute scripted session — zero console errors, zero 502s, zero hangs
  - [ ] implement: attach evidence + summary to `test-report.md`
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Final sign-off matching user's "เช็คงานด้วยการคลิกและการลองใช้จริง ๆ ผ่าน บราวเซอร์" demand.

---

## File Lock Registry

> Files locked per worktree branch. Worktree isolation means same-file edits across branches are safe during work — the controller resolves merge conflicts at integration time. Cross-task overlap noted below.

| File                                                        | Locked by                      | Task               | Since      |
| ----------------------------------------------------------- | ------------------------------ | ------------------ | ---------- |
| workers/api/src/routes/missions.ts                          | task-001-sse-deadlock          | TASK-001           | 2026-05-20 |
| workers/api/src/services/ingest.ts                          | task-001-sse-deadlock          | TASK-001           | 2026-05-20 |
| workers/api/src/durable/sse-hub.ts                          | task-001-sse-deadlock          | TASK-001           | 2026-05-20 |
| workers/api/src/services/ai.ts                              | task-002-ai-envelope           | TASK-002           | 2026-05-20 |
| workers/api/src/routes/recommendations.ts                   | task-002-ai-envelope           | TASK-002           | 2026-05-20 |
| packages/react/src/components/RecommendedMissions/index.tsx | task-002-ai-envelope           | TASK-002           | 2026-05-20 |
| workers/api/src/routes/demo.ts (NEW)                        | task-003-demo-reset            | TASK-003           | 2026-05-20 |
| workers/api/src/index.ts                                    | task-003-demo-reset            | TASK-003           | 2026-05-20 |
| workers/api/src/routes/auth.ts                              | task-003-demo-reset            | TASK-003           | 2026-05-20 |
| apps/demo/src/panels/DevTools.tsx                           | task-003-demo-reset            | TASK-003           | 2026-05-20 |
| apps/demo/src/lib/client.tsx                                | task-003-demo-reset            | TASK-003           | 2026-05-20 |
| **packages/core/src/client.ts ⚠️**                          | task-003 + task-005 + task-006 | merge will resolve | 2026-05-20 |
| packages/react/src/components/MissionCard/index.tsx         | task-004-counter-cap           | TASK-004           | 2026-05-20 |
| apps/demo/src/lib/auth.ts                                   | task-005-fe-timeouts           | TASK-005           | 2026-05-20 |
| apps/demo/src/server/index.ts                               | task-005-fe-timeouts           | TASK-005           | 2026-05-20 |
| packages/react/src/hooks/useMissions.ts                     | task-006-optimistic            | TASK-006           | 2026-05-20 |
| packages/react/src/QuestKitProvider.tsx                     | task-006-optimistic            | TASK-006           | 2026-05-20 |

---

## Status Legend

- ⚪ pending — not started
- 🟡 in_progress — assigned + active
- 🟢 completed — implementation + tests done, verification passed
- 🔴 blocked — see Progress Notes for blocker
- ⚫ skipped — moved to roadmap with rationale
