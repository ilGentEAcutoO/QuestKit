# Plan: Phase 8 / v0.1.4 — Demo Stability & Production Hardening

> Created: 2026-05-20 18:20
> Status: approved (no draft requested — populate todos.md immediately)
> Predecessor: archived 001-phase-7-security-hardening-v0.1.3
> Live target: https://questkit.jairukchan.com (and `/ecommerce`, `/streaming`, `/daily`, `/minigames`)

## Requirements

User opened the live demo and found it unusable: claim hangs, counters frozen at impossible values (`19/5`, `6/1`), Watch page hangs, "Logging…" buttons stuck, "Reset demo user" doesn't actually reset, AI picks returns 502. User explicitly demands browser-level verification of every button on every scenario. Exact wording preserved in `requirements.md`.

## Architecture

### Root cause map (from parallel research agents — api-audit.md, frontend-audit.md, deploy-audit.md)

| User-reported symptom        | Root cause (file:line)                                                                                                                                                  | Fix locus                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Claim hangs                  | `workers/api/src/routes/missions.ts:287-293` awaits `tryBroadcastClaim`, which awaits SSE_HUB DO RPC                                                                    | API worker                           |
| Counters frozen / `19/5`     | Same as claim hang (broadcast deadlock blocks all subsequent ingests + reads via SSE update)                                                                            | API worker                           |
| Counters never decrement     | `rules/evaluator.ts:130-132` lets `currentCount` overshoot; no client cap                                                                                               | API worker + React `MissionCard`     |
| Watch page hangs             | Same broadcast deadlock — any stuck SSE writer wedges the user's whole API                                                                                              | API worker                           |
| "Logging…" stuck             | `useEvent.isFiring` never clears because `fireEvent` -> `mintToken` has no timeout (FE) AND `/v1/auth/token` likely 500 if `APP_SECRET`/`JWT_SECRET` unset in prod (BE) | API worker (verify secrets) + FE SDK |
| Reset demo user does nothing | `apps/demo/src/panels/DevTools.tsx:122-134` is local-storage-only, by design (Phase 6 TODO never done)                                                                  | API worker (new endpoint) + Demo UI  |
| AI picks 502                 | `workers/api/src/services/ai.ts:215-222` only handles `aiResponse.response` (string) — `-fast` variant returns differently-shaped envelope                              | API worker                           |
| Cannot trust deploy / state  | No `deploy.yml` in CI; D1 migrations 0003/0004 may not be in prod; `wrangler.dev.jsonc` is the only file with real IDs and it is gitignored                             | CI/CD + ops doc                      |

### Fix strategy (5 layers)

1. **Backend hot-path hardening** — detach SSE broadcasts via `c.executionCtx.waitUntil(...)`, add `AbortSignal.timeout(2000)` on every DO `stub.fetch`, parallelize `SSEHub.broadcast` writers with `Promise.allSettled`.
2. **AI parser resilience** — accept multiple envelope shapes from Workers AI (`response` string, `result` object, raw object); fall back to cached recommendations on parse failure; graceful empty-state in UI instead of red error.
3. **Server-side demo reset** — add `POST /v1/demo/reset` that wipes `mission_progress`, `balances`, `events`, and `KV idem:${userId}:*`, `rec:${userId}` for the caller's userId. Wire DevTools to call it.
4. **Frontend defenses** — fetch timeouts (10s) on every SDK method, optimistic counter updates from `fireEvent.missionsUpdated[]`, cap display `Math.min(currentCount, targetCount)` in `MissionCard`.
5. **Reproducible deploys** — `deploy.yml` in CI that runs D1 migrations, deploys all six workers via Cloudflare API token, verified with a post-deploy smoke test. Move the committed `wrangler.jsonc` away from `<set-per-env>` placeholders so it works on a clean clone.

### Test boundaries

- Worker tests: `@cloudflare/vitest-pool-workers` — verify broadcast detachment by spawning a stuck DO writer and asserting claim returns in <100 ms.
- React tests: Jest + RTL — verify counter display cap + optimistic update path.
- E2E: Playwright on a deployed preview (Workers preview URL per PR), then re-run on production after merge. **Every Buy, Claim, Spin, Scratch, Watch, Check-in, Reset, Open-AI-picks button must have a test.**

## Security Considerations

- `POST /v1/demo/reset` is dangerous if exposed broadly. Gate it to the `demo_user_*` userId pattern (or any userId whose JWT was minted with `kind: "demo"` claim) so a paid customer's data can never be wiped.
- `AbortSignal.timeout(2000)` on DO RPC must NOT cause silent data loss — broadcasts are best-effort by design, but balance UPSERT inside `claimMissionDb` already commits before broadcast, so timing out the broadcast is safe.
- AI fallback must not leak prompt content into the cache key — keep the cache key as just `rec:${userId}` (existing).
- New `deploy.yml` will need a Cloudflare API token in GitHub secrets (`CLOUDFLARE_API_TOKEN`). Token must have only `Workers Scripts:Edit`, `D1:Edit`, `Account:Read` — not `Account:Edit`.
- The "fresh user id" path via URL query (`?user=...`) should NOT be removed yet — keep as escape hatch even after reset endpoint ships, but warn DevTools UI that it bypasses the new server reset.

## Test Specifications (TDD)

### Unit Tests (Jest / Vitest)

- `workers/api/src/durable/sse-hub.test.ts` — broadcast with 1 stalled writer + 2 healthy writers must complete in <50 ms (currently >5000 ms).
- `workers/api/src/routes/missions.test.ts` — claim must return success even if SSE broadcast aborts (timeout simulated).
- `workers/api/src/services/ai.test.ts` — given each of (a) `{response: "{...}"}`, (b) `{result: {...}}`, (c) `{...}` raw, parser must succeed.
- `workers/api/src/routes/demo.test.ts` (NEW) — `POST /v1/demo/reset` wipes only the caller's data, refuses non-demo userIds with 403.
- `packages/react/src/components/MissionCard/MissionCard.test.tsx` — counter rendering must clamp `current` to `target` for the textual display.
- `packages/core/src/client.test.ts` — every method must abort and reject with `QuestKitError({code: "timeout"})` after 10s.

### UI Tests (RTL / Storybook)

- `MissionCard.stories.tsx` — variant "overshot" with `currentCount=19, targetCount=5` renders "5 / 5" (clamped).
- `RecommendedMissions.stories.tsx` — "server_error" variant renders graceful empty-state (no raw `ai_response_malformed`).

### E2E Tests (Playwright — runs against live deploy)

Coverage matrix — every interactive element on every route must have a happy-path test, plus 1 regression test for the user's bug:

| Route        | Element                      | Happy path                                                                           | Regression check                                    |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| `/ecommerce` | Buy now (×6 products)        | Fires `purchase.completed`, EventLog shows entry, mission counter updates within 3 s | Counter never exceeds target after multiple clicks  |
| `/ecommerce` | Claim button on each mission | Returns in <2 s, button flips to "Claimed", balance updates                          | Page that has a Watch tab open does not block Claim |
| `/streaming` | Watch (×4 videos)            | Fires `video.watched`, button returns to "Watch" in <2 s                             | "Logging…" never persists >3 s                      |
| `/daily`     | Check in                     | Streak counter increments, mission progress updates                                  | Refresh page still shows streak                     |
| `/minigames` | Spin wheel                   | Wheel animates, reward toast appears, mission progress updates                       | Spin cooldown enforced                              |
| `/minigames` | Scratch card                 | Card reveals, reward fires `minigame.played`, progress updates                       | All 3 reveals advance Scratch Master to 3/3         |
| Global       | AI picks panel               | Opens, shows recommendations OR graceful empty-state — NEVER raw 502                 | Re-open does not re-hit server within 5 min cache   |
| Global       | DevTools → Reset demo user   | All missions return to "claimable" or "in-progress" with 0 progress                  | Balance returns to seed value, EventLog clears      |
| Global       | EventLog drawer              | Opens, shows recent events, closes                                                   | -                                                   |
| Global       | Coin balance widget          | Updates within 2 s of any reward-granting action                                     | -                                                   |

Test runner: `pnpm --filter @questkit/demo e2e:prod` — new script that runs `playwright test` with `BASE_URL=https://questkit.jairukchan.com`.

## Tasks

### TASK-001: Fix SSE broadcast deadlock (claim/watch/counter hang)

- Priority: high
- Parallel: yes (independent of other API fixes)
- Depends on: -
- Skills: workflow-work, git-commit, deploy
- Files: `workers/api/src/routes/missions.ts`, `workers/api/src/services/ingest.ts`, `workers/api/src/durable/sse-hub.ts`
- Subtasks:
  - [ ] implement: switch `await tryBroadcastClaim(...)` to `c.executionCtx.waitUntil(tryBroadcastClaim(...))`
  - [ ] implement: switch `await tryBroadcastProgress(...)` to `waitUntil` in `services/ingest.ts`
  - [ ] implement: add `signal: AbortSignal.timeout(2000)` to every `stub.fetch` call in api worker
  - [ ] implement: parallelize `SSEHub.broadcast` writers with `Promise.allSettled` + per-writer 1s timeout
  - [ ] test: vitest-pool-workers unit test that proves claim returns <100 ms with one stalled SSE writer
  - [ ] test: integration test that proves counters keep advancing even while watch page holds an EventSource

### TASK-002: Fix AI recommendations 502 envelope mismatch

- Priority: high
- Parallel: yes
- Depends on: -
- Skills: workflow-work, git-commit, deploy
- Files: `workers/api/src/services/ai.ts`, `workers/api/src/routes/recommendations.ts`, `packages/react/src/components/RecommendedMissions/index.tsx`
- Subtasks:
  - [ ] implement: in `ai.ts`, accept `aiResponse.response` (string), `aiResponse.result` (object), and bare object — normalize before `tryParseJson`
  - [ ] implement: on parse failure, return `{ fallback: true, items: [] }` instead of throwing `AiResponseError`
  - [ ] implement: `recommendations.ts` returns 200 with `{ items: [], fallback: true, reason: "ai_unavailable" }` instead of 502
  - [ ] implement: `<RecommendedMissions>` renders graceful empty-state ("AI picks unavailable right now") when `fallback: true`
  - [ ] test: ai.test.ts covers all 3 envelope shapes
  - [ ] test: RecommendedMissions story for fallback state

### TASK-003: Add server-side demo reset endpoint

- Priority: high
- Parallel: yes
- Depends on: -
- Skills: workflow-work, git-commit, deploy, env-sync
- Files: `workers/api/src/routes/demo.ts` (NEW), `workers/api/src/index.ts`, `workers/api/src/db/schema.ts`, `apps/demo/src/panels/DevTools.tsx`, `apps/demo/src/lib/client.tsx`
- Subtasks:
  - [ ] implement: new route `POST /v1/demo/reset` — verifies JWT `kind === "demo"` claim (or userId starts with `demo_`), then wipes `mission_progress`, `balances`, `events` rows for that userId in a single `db.batch`
  - [ ] implement: also delete KV keys `idem:${userId}:*` and `rec:${userId}`
  - [ ] implement: extend `POST /v1/auth/token` to include `kind: "demo"` in JWT claims when caller hits the demo's mint proxy
  - [ ] implement: rewire DevTools "Reset demo user" to call `client.demoReset()` then clear local cache + reload
  - [ ] implement: update DevTools footer copy to say "Clears server-side progress, balance, and event history."
  - [ ] test: API test confirms wipe affects only target userId
  - [ ] test: API test confirms non-demo JWT returns 403

### TASK-004: Cap counter display + clarify claimed state

- Priority: medium
- Parallel: yes
- Depends on: -
- Skills: workflow-work, git-commit
- Files: `packages/react/src/components/MissionCard/index.tsx`, `packages/react/src/components/MissionCard/MissionCard.test.tsx`
- Subtasks:
  - [ ] implement: in `<MissionCard>`, render text counter as `${Math.min(currentCount, targetCount)} / ${targetCount}`
  - [ ] implement: progress bar already uses `value={currentCount} max={targetCount}` — ensure overshoot doesn't break visually (clamp at 100%)
  - [ ] implement: when `status === "claimed"`, dim the counter and show a small "✓ claimed today" hint
  - [ ] test: RTL test: rendering with `current=19, target=5` shows "5 / 5"
  - [ ] test: claimed state renders the new hint

### TASK-005: Frontend fetch timeouts (defense-in-depth)

- Priority: medium
- Parallel: yes
- Depends on: -
- Skills: workflow-work, git-commit
- Files: `packages/core/src/client.ts`, `apps/demo/src/lib/auth.ts`, `apps/demo/src/server/index.ts`
- Subtasks:
  - [ ] implement: `client.ts` — every internal `fetch` gets `signal: AbortSignal.timeout(10000)` (configurable via constructor `timeoutMs`)
  - [ ] implement: timeout rejects with `QuestKitError({ code: "timeout" })`
  - [ ] implement: `apps/demo/src/lib/auth.ts` mint fetch also gets `AbortSignal.timeout(10000)`
  - [ ] implement: `apps/demo/src/server/index.ts` upstream fetch gets `AbortSignal.timeout(8000)` to fail-fast on slow api
  - [ ] test: client.test.ts asserts each method rejects with timeout error when fetch hangs
  - [ ] test: useEvent / useMissionClaim hooks unstick `isFiring` / `isClaiming` after timeout

### TASK-006: Optimistic counter updates from `fireEvent`

- Priority: low
- Parallel: yes
- Depends on: -
- Skills: workflow-work, git-commit
- Files: `packages/react/src/hooks/useMissions.ts`, `packages/react/src/QuestKitProvider.tsx` (or wherever the cross-hook event bus lives)
- Subtasks:
  - [ ] implement: `useMissions` listens to a new SDK callback `onFireEventSuccess(missionsUpdated)` and merges into local `data.progress`
  - [ ] implement: this makes counters move even when SSE is degraded
  - [ ] test: simulate SSE outage; counter still advances on `fireEvent`

### TASK-007: Reproducible CI deploy + automated D1 migrations

- Priority: high
- Parallel: no — must come AFTER 001-003 are merged so the deploy actually ships fixes
- Depends on: TASK-001, TASK-002, TASK-003
- Skills: workflow-work, deploy, env-sync, git-push
- Files: `.github/workflows/deploy.yml` (NEW), `workers/api/wrangler.jsonc`, `package.json`, `docs/SELF_HOSTING.md`
- Subtasks:
  - [ ] implement: `deploy.yml` triggered on push to `main` after CI passes; uses `cloudflare/wrangler-action@v3`
  - [ ] implement: workflow runs `wrangler d1 migrations apply questkit-d1-main --remote` before deploying any worker
  - [ ] implement: workflow deploys all 6 workers in order (api → consumer → relay → demo → docs → playground)
  - [ ] implement: post-deploy smoke step hits `GET https://api.questkit.jairukchan.com/v1/health` and `GET https://questkit.jairukchan.com/` and asserts 200
  - [ ] implement: move D1 / KV ids out of `wrangler.dev.jsonc` into `wrangler.jsonc` `[env.production]` block (still gitignore the actual values via `wrangler.local.jsonc`)
  - [ ] implement: document required GitHub secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `JWT_SECRET`, `APP_SECRET`, `WEBHOOK_HMAC_SECRET`) in `docs/SELF_HOSTING.md`
  - [ ] test: dry-run with `--dry-run --outdir=dist/preview` for each worker
  - [ ] test: a release-candidate branch deploy succeeds end-to-end

### TASK-008: Verify production secrets + migrations (read-only check)

- Priority: high
- Parallel: yes (independent diagnostic; run early)
- Depends on: -
- Skills: workflow-work
- Files: -
- Subtasks:
  - [ ] implement: `pnpm wrangler secret list --name questkit-worker-api` — confirm `JWT_SECRET`, `APP_SECRET`, `WEBHOOK_HMAC_SECRET` are set
  - [ ] implement: `pnpm wrangler d1 execute questkit-d1-main --remote --command "SELECT name FROM d1_migrations ORDER BY id;"` — confirm 0003/0004 are applied
  - [ ] implement: if missing, apply via `wrangler d1 migrations apply ... --remote`
  - [ ] implement: tail logs during a live claim with `pnpm wrangler tail questkit-worker-api` and capture stack
  - [ ] test: smoke-test claim against live api with `curl` after fixes are deployed

### TASK-009: Playwright E2E suite against live deploy

- Priority: high
- Parallel: no — depends on most fixes being merged so the suite can pass
- Depends on: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-007
- Skills: workflow-work, frontend-test, git-commit
- Files: `apps/demo/e2e/*.spec.ts`, `apps/demo/playwright.config.ts`, `package.json`
- Subtasks:
  - [ ] implement: `apps/demo/e2e/ecommerce.spec.ts` — every Buy + every Claim per table in §Test Specifications
  - [ ] implement: `apps/demo/e2e/streaming.spec.ts` — every Watch button
  - [ ] implement: `apps/demo/e2e/daily.spec.ts` — Check in flow
  - [ ] implement: `apps/demo/e2e/minigames.spec.ts` — Spin + Scratch
  - [ ] implement: `apps/demo/e2e/cross-cutting.spec.ts` — AI picks, EventLog, DevTools reset, coin balance widget
  - [ ] implement: new `e2e:prod` and `e2e:preview` scripts; preview URL is the Cloudflare Workers preview URL emitted by `wrangler deploy --dry-run`
  - [ ] implement: add Playwright job to `deploy.yml` post-deploy, runs `e2e:prod` and fails the deploy on regression
  - [ ] test: full suite green against current `main` after all other tasks merged

### TASK-010: Browser sanity verification (the user's "test by clicking" demand)

- Priority: high
- Parallel: no — must be last (after deploy completes)
- Depends on: TASK-001 through TASK-009
- Skills: frontend-test
- Files: -
- Subtasks:
  - [ ] implement: manually open https://questkit.jairukchan.com, run through all 4 routes
  - [ ] implement: capture screenshots/GIF for: claim returns, counter caps at target, watch returns, AI picks shows real content (or graceful empty), reset clears claims
  - [ ] implement: attach evidence to `instruction/work/test-report.md`
  - [ ] test: zero console errors, zero 502s, zero hangs over a 10-minute scripted session

## Notes for workflow-work executor

- Pick TASK-008 first as a cheap diagnostic — it informs whether 001/007 fixes will actually take effect or whether prod is just missing migrations.
- TASKs 001, 002, 003, 004, 005, 006 are fully parallel-friendly — dispatch them as an agent team with worktree isolation.
- TASK-007 is the deploy gate; everything before it must merge first.
- TASK-009 + TASK-010 are verification — last.
- Each task lists its `Skills:` line so workflow-work knows what to invoke.
