# QuestKit — Active Tasks (Phase 8 / v0.1.4)

> Last updated: 2026-05-20 19:30
> Plan: [`plan.md`](./plan.md) · Requirements: [`requirements.md`](./requirements.md)
> Predecessor archived at `../archive/001-phase-7-security-hardening-v0.1.3/`

---

### Task: [TASK-001] Fix SSE broadcast deadlock (claim/watch/counter hang)

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
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

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
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

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
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

- **Status:** ⚪ pending
- **Priority:** medium
- **Parallel:** yes
- **Assigned:** unassigned
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

- **Status:** 🟢 done
- **Priority:** medium
- **Parallel:** yes
- **Assigned:** task-005 worker (worktree: task-005-fe-timeouts)
- **Depends on:** -
- **Skills:** workflow-work, git-commit
- **Files:**
  - `packages/core/src/client.ts`
  - `packages/core/src/errors.ts`
  - `packages/core/test/client.test.ts`
  - `apps/demo/src/lib/auth.ts`
  - `apps/demo/src/server/index.ts`
  - `packages/react/src/components/MissionCard/index.tsx`
  - `packages/react/test/components/MissionCard.test.tsx`
  - `packages/react/test/hooks/useEvent.test.tsx`
- **Subtasks:**
  - [x] implement: every internal `fetch` in core/client.ts gets `signal: AbortSignal.timeout(10000)` (configurable via constructor `timeoutMs`) — centralised via private `request()` helper so TASK-003's `demoReset()` will inherit it automatically
  - [x] implement: timeout rejects with `QuestKitError({ code: "timeout" })` (message names the configured ms so logs are diagnosable)
  - [x] implement: demo mint fetch + upstream proxy fetch both get timeouts (10s / 8s)
  - [x] test: client.test.ts — each public method (mint/getMissions/getMission/claim/getBalances/getBalance/getCampaigns/getCampaign/getRecommendations) rejects with timeout when fetch hangs; fireEvent queues (intentional, see Progress Notes); end-to-end AbortSignal.timeout mapping verified
  - [x] test: useEvent unsticks `isFiring` after timeout (rejection + queue paths); MissionCard's `Claiming…` state clears after onClaim rejects with timeout
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Even after TASK-001 fixes the deadlock, FE-side timeouts convert any future API hang into a recoverable toast.
  - 2026-05-20 19:30 — Implemented. Centralised SDK fetch through `private async request()` so every existing method AND future ones (TASK-003 demoReset) inherit the timeout. `fireEvent` intentionally swallows timeouts → returns `queued: true` (preserves the at-least-once contract); other methods reject with `QuestKitError({code:"timeout"})`. Demo's `/api/token` browser fetch gets 10s, demo worker's upstream hop gets 8s. Added 15 timeout-specific tests in client.test.ts + 2 in useEvent.test.tsx + 1 in MissionCard.test.tsx. Also patched MissionCard's click handler to `.catch()` the rejected handleClaim — otherwise a timeout reaches the host as an unhandled-rejection. All 230 tests green (102 core + 128 react), typecheck + prettier clean.

---

### Task: [TASK-006] Optimistic counter updates from `fireEvent`

- **Status:** ⚪ pending
- **Priority:** low
- **Parallel:** yes
- **Assigned:** unassigned
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

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
- **Depends on:** -
- **Skills:** workflow-work
- **Files:** -
- **Subtasks:**
  - [ ] implement: `pnpm wrangler secret list --name questkit-worker-api` — confirm 3 secrets present
  - [ ] implement: `pnpm wrangler d1 execute questkit-d1-main --remote --command "SELECT name FROM d1_migrations ORDER BY id;"`
  - [ ] implement: if migrations 0003/0004 missing → apply via `wrangler d1 migrations apply ... --remote`
  - [ ] implement: `pnpm wrangler tail questkit-worker-api` during a live claim — capture stack
  - [ ] test: post-fix smoke — `curl POST /v1/missions/.../claim` returns <2s
- **Progress Notes:**
  - 2026-05-20 18:20 — Created. Pick this first — it tells us whether code fixes alone will suffice or whether prod is silently behind on migrations.

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

| File      | Locked by | Task | Since |
| --------- | --------- | ---- | ----- |
| _(empty)_ |           |      |       |

---

## Status Legend

- ⚪ pending — not started
- 🟡 in_progress — assigned + active
- 🟢 completed — implementation + tests done, verification passed
- 🔴 blocked — see Progress Notes for blocker
- ⚫ skipped — moved to roadmap with rationale
