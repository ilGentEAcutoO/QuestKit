# QuestKit — Active Tasks

> Last updated: 2026-05-21 14:05 (workflow-exit during v0.1.9 hotfix — RESUME CONTEXT updated; working tree WIP-committed)

## RESUME CONTEXT (v0.1.9 hotfix mid-flight)

> Exit time: 2026-05-21 14:05
> Reason: User invoked /workflow-exit during v0.1.9 hotfix work
> Working tree: WIP commit pinned to `main`. Sub-agents stopped via TaskStop.

### What's landed (in the WIP commit)

| File                                                                      | Status                                                                                                                                                                                                                                                                                                              | Origin                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `package.json` (0.1.8 → 0.1.9)                                            | ✅ clean                                                                                                                                                                                                                                                                                                            | Main agent                                                                                                                 |
| `workers/api/src/index.ts` (/v1/health version → 0.1.9)                   | ✅ clean                                                                                                                                                                                                                                                                                                            | Main agent                                                                                                                 |
| `CHANGELOG.md` (+ v0.1.9 entry above v0.1.8)                              | ✅ clean                                                                                                                                                                                                                                                                                                            | Main agent                                                                                                                 |
| `instruction/work/test-report.md` (TASK-009 walkthrough section appended) | ✅ clean                                                                                                                                                                                                                                                                                                            | Main agent                                                                                                                 |
| `instruction/work/todos.md` (TASK-009 status; this RESUME CONTEXT block)  | ✅ clean                                                                                                                                                                                                                                                                                                            | Main agent                                                                                                                 |
| `workers/api/src/services/ingest.ts:175-184`                              | ✅ landed (UNVERIFIED)                                                                                                                                                                                                                                                                                              | Worker sub-agent — source fix: KV replay returns `missionsUpdated:[]`, matches D1 replay symmetry. Comment explains.       |
| `workers/api/test/events.route.test.ts` (+71 LOC)                         | ✅ landed (UNVERIFIED)                                                                                                                                                                                                                                                                                              | Worker sub-agent — regression test for KV replay; possibly updated an existing test that expected the old broken behavior. |
| `apps/demo/src/components/DemoToastHost.tsx` (+68 LOC)                    | ⚠️ HALF + **PARKED IN STASH@{0}** — lint failed (unused `toastLabel`, `ToastIcon` from interrupted refactor) so was kept out of the WIP commit. Stash msg: `workflow-exit: DemoToastHost half-done error-variant refactor (v0.1.9 F1 demo fix in-progress) - 2026-05-21 14:05`. Pop with `git stash pop stash@{0}`. | Demo sub-agent                                                                                                             |
| `apps/demo/src/lib/useMissionClaim.ts:72-74`                              | ❌ **NOT YET WIRED** to the new toast — still does `console.warn` only                                                                                                                                                                                                                                              | Demo sub-agent stopped before this edit                                                                                    |
| `apps/demo/src/lib/useMissionClaim.test.tsx` (new Jest spec)              | ❌ NOT created — demo sub-agent never reached this                                                                                                                                                                                                                                                                  | Pending                                                                                                                    |
| `agent-temp/phase9-01..06.png` (6 walkthrough screenshots)                | ✅ moved into agent-temp/ (rule: never at project root)                                                                                                                                                                                                                                                             | Main agent                                                                                                                 |

### Resume entry point (next session — what /workflow-work must do)

1. **Verify worker fix:**
   - `git diff workers/api/src/services/ingest.ts` — confirm the ~7-line change at lines 175-184 looks sane (matches D1 symmetry; comment explains why).
   - `git diff workers/api/test/events.route.test.ts` — review the +71 LOC; the new test must construct an idempotent replay and assert response has `missionsUpdated: []`. If an existing test was modified (e.g., one previously asserting `missionsUpdated: ['mis_...']` on a replay), confirm the update is correct.
   - Run gates: `pnpm --filter @questkit/worker-api test`, `pnpm --filter @questkit/worker-api typecheck`, `pnpm --filter @questkit/worker-api lint`. All must be GREEN.

2. **Finish demo fix:**
   - **First — recover the parked DemoToastHost edit:** `git stash list` (look for `workflow-exit: DemoToastHost half-done…`), then `git stash pop stash@{0}`. This restores the half-done error-variant refactor to the working tree.
   - `git diff apps/demo/src/components/DemoToastHost.tsx` — review the +68 LOC for the new error toast variant. Confirm the API the demo sub-agent designed is reasonable (probably extending `Reward | {kind:"error", ...}` or similar). Note: the file currently fails ESLint with `'toastLabel' is defined but never used` and `'ToastIcon' is defined but never used` because the refactor is mid-flight — wiring `useMissionClaim` to consume the new variant is what makes those vars "used."
   - **Wire `apps/demo/src/lib/useMissionClaim.ts:72-74`** — expand the catch block:
     ```ts
     } catch (err) {
       console.warn("[demo] claimMission failed", err);
       if (isQuestKitError(err) && (err.status === 409 || err.code === "claim_not_ready")) {
         showToast({ kind: "error", /* match the contract the agent built into DemoToastHost */ });
         if (onClaimed !== undefined) {
           try { await onClaimed(); } catch (e) { console.warn("[demo] post-409 refetch failed", e); }
         }
       }
     }
     ```
     Import `QuestKitError` (or whatever the SDK exports) from `@questkit/core`. Pick the right error-detection predicate based on what `packages/core/src/client.ts` exports — likely `err instanceof QuestKitError && err.code === "claim_not_ready"`.
   - **Write `apps/demo/src/lib/useMissionClaim.test.tsx`** — Jest test that mocks `client.claimMission` to reject with `QuestKitError` (409 claim_not_ready), mocks `showToast` + `onClaimed`, asserts both were called.
   - Run gates: `pnpm --filter @questkit/demo test`, `…typecheck`, `…lint`.

3. **Converge gates from root:** `pnpm typecheck && pnpm lint && pnpm test` — all packages.

4. **Amend WIP commit** (or new commit on top):
   - The current WIP commit is named `WIP: workflow-exit during v0.1.9 hotfix …`. Either amend it with the additional changes, or land a NEW commit titled `v0.1.9 hotfix — F1 fix (KV replay symmetry + demo toast)`. Use the `git-commit` skill. **NO AI signature** per CLAUDE.md rule #7.

5. **Push + monitor CI:** `git push`, then `gh run watch` (or just `gh run list -L 5`). CI must turn green; deploy workflow must run; smoke test must pass. The E2E step may stay red — that's the still-unresolved TASK-005 manual gate (orthogonal to v0.1.9).

6. **Prod verify:**
   - `curl https://api.questkit.jairukchan.com/v1/health` — expect `{"ok":true,"version":"0.1.9","commit":"…"}`.
   - Reproduce F1: open `https://questkit.jairukchan.com` in a private window (fresh user — no carry-over), watch 3 documentaries, claim Curious Mind — must succeed cleanly (200 with reward, no 409). For an EXISTING multi-session user (the F1 trigger scenario), the new demo toast + refetch should now appear instead of silent failure.

7. **Archive Phase 9:** `/workflow-end` — moves work/\* into `instruction/archive/003-phase-9-v0.1.8-bug-fix-sweep/` (or rename to reflect 0.1.9 in the archive folder name). Resets work/ for Phase 10.

### Sub-agent IDs (stopped, do not resume — work was captured in the working tree)

- Worker fix agent: `a8d14cd71a40e3c27` — last reported action "Now run the new test to confirm GREEN, plus the full worker-api suite + typecheck + lint." (killed before this happened)
- Demo fix agent: `a989e2b1275da7081` — last reported action "Now update the toast rendering to use the new shape and apply error styling." (was mid-edit on DemoToastHost when killed; never reached useMissionClaim wiring)

### Phase 10 backlog (carried forward unchanged from earlier RESUME CONTEXT)

- Server-side minigame coin mint (B5 option b)
- BadgeWall persistence via `user_badges` table (badges granted outside mission flow)
- Replace `local-only` `binge_starter` celebration toast with a real server-side mission
- TASK-007 (D3) — reopen for defensive optimistic-counter pattern review (the v0.1.9 hotfix removes the trigger but the pattern itself still relies on `missionsUpdated` accuracy)

---

## RESUME CONTEXT — SUPERSEDED (kept for history)

> ⚠️ This earlier RESUME CONTEXT (13:30) is **superseded** by the newer
> "RESUME CONTEXT (v0.1.9 hotfix mid-flight)" block at the top of this
> file. The 13:30 block documents the state right after Phase 9 shipped
> v0.1.5–v0.1.8; the 14:05 block documents the v0.1.9 hotfix
> mid-flight state which is what the next session must resume from.
>
> Exit time: 2026-05-21 13:30
> Reason: User invoked /workflow-exit — session checkpoint
> Working tree: clean. All changes committed and pushed.

### Session outcome — Phase 9 v0.1.5 → v0.1.8 shipped

All 8 planned Phase 9 tasks complete. Three follow-up hotfixes
(v0.1.6 → v0.1.8) walked the B6 root-cause bisect to a verified fix.

| Version | Commit    | Status                                                                 |
| ------- | --------- | ---------------------------------------------------------------------- |
| v0.1.5  | `7321670` | Phase 9 bug-fix sweep (B1/B3/B4/B5 + D1–D6 + CI gate code side)        |
| v0.1.6  | `1021905` | BadgeWall panel + Canvas2D opt-in + AI model swap (B6 step 1)          |
| v0.1.7  | `a8120d2` | response_format → json_schema (B6 step 2)                              |
| v0.1.8  | `bbe0a0f` | 4th envelope strategy `response-object` (B6 step 3 — VERIFIED WORKING) |

### Production state — 2026-05-21 13:30

- `https://api.questkit.jairukchan.com/v1/health` → `{"ok":true,"version":"0.1.8"}`
- `GET /v1/recommendations` → real LLM picks, no `fallback:true` field
- All v0.1.5 bug fixes shipped: claim flow, widget reconciliation, honest minigame
  toasts, footer version, Curious Mind audit, observability
- BadgeWall panel deployed (top-left FAB, code-split ~4kB)
- ScratchCard Canvas2D warning silenced

### Remaining manual items for user (no code work pending)

1. **Manual browser walkthrough at `https://questkit.jairukchan.com`** — re-test
   B1/B3/B4/B5 + verify BadgeWall + verify AI picks panel populates. Phase 9
   acceptance.
2. **Optional: unblock CI E2E gate** — `openssl rand -hex 32` → GH secret
   `CI_BOT_BYPASS_TOKEN` + CF dashboard WAF rule per `docs/SELF_HOSTING.md` §8.6.
   Workers + bug fixes are already live; only the E2E badge stays red until
   these manual steps land.
3. **Phase 10 backlog** — already noted in CHANGELOG / test-report:
   - Server-side minigame coin mint (B5 option b — deferred per scope)
   - Potential BadgeWall persistence via a `user_badges` table if a future
     phase wants badges granted outside the mission flow
   - Replace `local-only` `binge_starter` celebration toast with a real
     server-side mission so it shows up in BadgeWall

### Agent States (all closed)

All 7 sub-agents from Wave 1 + Wave 2 completed and reported in. No background
processes or unfinished work. Working tree is clean — no stash, no WIP commit
needed.

### Resume entry point

If next session asks "มีงานค้างไหม":

- `instruction/work/` still has `plan.md`, `requirements.md`, `test-report.md`,
  `todos.md` for Phase 9. Either:
  - **Archive Phase 9** via `/workflow-end` — moves the work/ files to
    `instruction/archive/003-phase-9-v0.1.8-bug-fix-sweep/` and resets work/.
  - **Continue with manual walkthrough** + the optional CI gate steps before
    archiving.

---

> Plan: [`./plan.md`](./plan.md)
> Requirements: [`./requirements.md`](./requirements.md)
> Previous phase archived at [`../archive/002-phase-8-v0.1.4-demo-stability/`](../archive/002-phase-8-v0.1.4-demo-stability/)
>
> **Original execution plan (for history):**
>
> - Wave 1 (parallel): TASK-001, TASK-003, TASK-004, TASK-005, TASK-006, TASK-007
> - Wave 2 (after TASK-001 done): TASK-002 (depends on `mission.claimed` SSE wire)
> - Wave 3 (sequential, after all): TASK-008 release

**Phase 8 backlog now absorbed into Phase 9:**

- TASK-011 (CI Playwright E2E gate) → **TASK-005** below
- TASK-012 (D1–D6 polish) → **distributed across TASK-002, TASK-003, TASK-004, TASK-007** below

---

## Active

### Task: [TASK-001] Cluster C1 — `mission.claimed` SSE event + refetch fallback

- **Status:** 🟢 done (awaiting downstream verification by TASK-002)
- **Priority:** P0
- **Parallel:** no (foundation — TASK-002 depends on this)
- **Assigned:** TASK-001 Agent
- **Depends on:** -
- **Skills:** -
- **Covers:** B1, D2
- **Files:**
  - `packages/types/src/sdk-update.ts`
  - `packages/react/src/hooks/useMissions.ts`
  - `packages/react/test/hooks/useMissions.test.tsx`
  - `packages/react/test/components/MissionCard.test.tsx`
  - `workers/api/src/routes/missions.ts`
  - `workers/api/src/routes/missions.test.ts`
  - `apps/demo/src/lib/useMissionClaim.ts`
  - **+ added (scoped deviation):** `apps/demo/src/panels/EventLog.tsx` (exhaustive-switch update), `apps/demo/src/routes/streaming.tsx` + `apps/demo/src/routes/daily.tsx` (wire `onClaimed: useMissions().refetch`), `packages/react/src/components/MissionList/index.tsx` + `packages/react/test/components/MissionList.test.tsx` (wrap `onClaim` to self-refetch — required so ecommerce's MissionList-owned `useMissions` instance also benefits from the safety net)
- **Subtasks:**
  - [x] test: `useMissions.test.tsx` — `mission.claimed` handler flips status (red→green)
  - [x] test: `MissionCard.test.tsx` — `status === "claimed"` display contract pinned (passes against existing display logic)
  - [x] test: `missions.test.ts` integration — claim delivers 3 SSE events to a live subscriber + ordering pinned
  - [x] implement: add `mission.claimed` variant to `SDKUpdate` union
  - [x] implement: emit `mission.claimed` from `tryBroadcastClaim` (FIRST in the 3-event sequence)
  - [x] implement: handler in `useMissions` for `mission.claimed` (terminal overwrite branch)
  - [x] implement: refetch fallback in `useMissionClaim` (+ MissionList wrap for ecommerce)
  - [x] verify: tests green (208 worker-api + 151 react incl. new) + typecheck clean + lint clean
- **Progress Notes:**
  - 10:15 - Task created
  - 11:20 - Started — claiming file locks for the 7 task files
  - 11:45 - Complete. 3 new tests added (useMissions, MissionList refetch fallback, missions.test.ts SSE delivery). MissionCard test extended with explicit data-status+disabled+label assertion. Demo's EventLog switch updated (exhaustive). Deviation noted: MissionList scope was expanded so ecommerce route's MissionList-owned useMissions also benefits from the refetch fallback — without this, B1 would still regress on ecommerce when SSE drops. All checks green.

### Task: [TASK-002] Cluster C2 — demo widgets reconciled to server state

- **Status:** 🟢 done (typecheck + lint + Jest tests green; e2e listed (54 tests across 7 specs); local e2e runtime deferred to TASK-008 walkthrough — local APP_SECRET infra gap)
- **Priority:** P1
- **Parallel:** yes (after TASK-001)
- **Assigned:** TASK-002 Agent (Opus 4.7)
- **Depends on:** TASK-001
- **Skills:** frontend-test
- **Covers:** B3, B4, D1
- **Files:**
  - `apps/demo/src/routes/streaming.tsx`
  - `apps/demo/src/routes/daily.tsx`
  - `apps/demo/e2e/claim-flow.spec.ts` (new — 3 tests × 2 projects = 6 listed entries)
  - `apps/demo/e2e/daily.spec.ts` (rewrite of streak-persistence test — server-state-backed)
  - `apps/demo/e2e/streaming.spec.ts` (regex tweak in "Logging…" test — accepts [1-3]/3 now that the counter mirrors the documentary mission)
- **Subtasks:**
  - [x] test: E2E `/streaming` Today's progress reconciles after claim without nav
  - [x] test: E2E `/daily` streak reconciles after claim without nav
  - [x] implement: derive `/streaming` widget from `useMissions()` (drop local `watchedToday`)
  - [x] implement: derive `/daily` streak hero from `useMissions()` (drop `localStorage`)
  - [x] implement: `Math.min(current, target)` clamp pattern consistent with MissionCard
  - [ ] verify: manual browser walkthrough — 5 watches + claim on each page, widget reconciles within 2s (deferred to TASK-008 release walkthrough — depends on full prod deploy)
- **Progress Notes:**
  - 10:15 - Task created
  - 2026-05-21 12:10 - Started. File locks claimed. Confirmed mission IDs from migrations 0002/0003: streaming widget will derive from `mis_stream_documentary_3` (count=3, the only 3-target streaming mission — "Curious Mind" badge — its filter is documentary-only, but it IS the canonical 3-target mission the widget was always meant to track). Daily widget will derive from `mis_daily_visitor` (count=1, daily, badge). `MissionProgress` shape has `status`, `currentCount`, `updatedAt` — no `lastIncrementedAt`, so daily claimedToday derivation = `status === "claimed"` OR (`updatedAt >= startOfDay(now)` AND `currentCount >= targetCount`).
  - 2026-05-21 12:30 - Implementation complete. streaming.tsx: dropped `watchedToday` useState, derived from `missionsState.data?.progress[mis_stream_documentary_3]` with `Math.min(currentCount, targetCount)` clamp. Binge Starter celebration uses `useRef` + `useEffect` that fires only on a strictly increasing transition INTO target during this session (guarded by `hasSeenInitialRef` so a reload with count already at 3 doesn't re-celebrate). daily.tsx: dropped STREAK_STORAGE_KEY + readStreak/writeStreak entirely. claimedToday derives from `progress.updatedAt` falling in today's UTC window AND currentCount > 0 (gated to avoid yesterday's "claimed" row triggering "Already checked in" on a fresh today visit — the evaluator resets the row on the first daily.login in a new window per workers/api/src/rules/evaluator.ts:99-125). streakCount = `claimedToday ? Math.min(currentCount, target) : 0`. Updated daily.spec.ts reload-persistence test to assert server MissionProgress round-trip (the persistence path the new code uses) instead of localStorage round-trip. Tweaked streaming.spec.ts regex from `^[1-9]\d*/3$` to `^[1-3]/3$` since the widget now mirrors the documentary mission's count and the 4-click run touches only 1 documentary. New claim-flow.spec.ts has 3 tests (ecommerce / streaming / daily) verifying the post-claim UI converges to status=claimed within 2s, widget reflects, no navigation. All verifications green: demo typecheck clean, demo lint clean, demo Jest 2/2 pass, Playwright `--list` shows 54 tests across 7 specs (3 new claim-flow tests visible on both chromium-desktop + mobile-chrome projects). Local Playwright runtime blocked by `apps/demo/.dev.vars` missing APP_SECRET (same infra gap TASK-005 documented + TASK-003 noted) — manual + CI E2E gates run in TASK-005's GitHub Actions workflow once the manual CF dashboard steps land.

### Task: [TASK-003] Cluster C3 — minigame toast honesty

- **Status:** 🟢 done (worker tests + typecheck + lint all green; local E2E blocked by missing APP_SECRET in .dev.vars — runs in CI via TASK-005)
- **Priority:** P1
- **Parallel:** yes
- **Assigned:** workflow-work (Opus 4.7)
- **Depends on:** -
- **Skills:** frontend-test
- **Covers:** B5, D6
- **Files:**
  - `apps/demo/src/routes/minigames.tsx`
  - `apps/demo/e2e/minigames.spec.ts` (existing — extending)
  - `workers/api/test/events.route.test.ts` (extending — existing events test file)
- **Subtasks:**
  - [x] test: E2E spin toast contains no "coin" substring (new test `TASK-003: spin wheel toast + caption mention NO coin`)
  - [x] test: E2E scratch toast contains no "coin" substring (new test `TASK-003: scratch card toast + caption + prize render NO coin`)
  - [x] test: integration `qk.minigame.spin` event does NOT mutate balances (3 new tests under `TASK-003 minigame no-currency-mint contract` — all GREEN against real D1)
  - [x] implement: replace coin labels with badge text in `minigames.tsx`. All 6 wheel slices now use `{kind:"badge", badgeId:"lucky_spinner"}` with celebration labels; scratch onReveal now passes `{kind:"badge", badgeId:"scratch_master"}`; prize panel shows "Scratch Master" (was "+30 coin"); "Won:" caption is badge-themed; bullet footer honestly states "No currency is minted by these events"
  - [x] implement: distinguish currency vs badge toast in `useDemoToast` — NOT NEEDED. `DemoToastHost.rewardLabel` already had a `badge` branch since Phase 8 (`DemoToastHost.tsx:48-50` → "Badge: ${badgeId}") with the `BadgeIcon` rendering correctly
  - [x] verify: confirmed grep on `minigames.tsx` — no "coin" / "+N coin" / "+N gem" appears in any user-visible label or caption. Only "coin"/"currency" mentions remaining are in code comments documenting the contract (intentional)
- **Progress Notes:**
  - 10:15 - Task created
  - 11:05 - Started. Confirmed reward shapes: server-side `mis_lucky_spinner` and `mis_scratch_master` (migration 0004) both have `reward_json = {"kind":"badge",...}`. Worker only mints currency in `claimMission` (db/schema.ts:722) — `POST /v1/events` never writes to balances regardless of event name. DemoToastHost already supports `kind:"badge"` (DemoToastHost.tsx:48-50 → "Badge: ${badgeId}"). Existing E2E spec at `apps/demo/e2e/minigames.spec.ts` — extending. Worker tests live in `/test/` (not `/src/routes/`) per project convention — extending `events.route.test.ts` rather than creating a new file.
  - 11:25 - GREEN: 3 new worker integration tests pass against real D1 / rule engine — `qk.minigame.spin` does NOT touch `balances`, `qk.minigame.scratch` does NOT touch `balances`, completing `mis_lucky_spinner` (5 spins → 5/5) STILL leaves balances empty. Worker-api typecheck + lint clean. 20 existing events tests still pass (23 total). Demo typecheck has 1 unrelated error in EventLog.tsx (TASK-001's `mission.claimed` SDKUpdate variant) — NOT introduced by this task. Playwright spec compiles (12 tests across 2 browsers); local E2E run blocked by missing APP_SECRET in `apps/demo/.dev.vars` (existing infra gap; TASK-005's CI-bypass work covers the production gate). Manual walkthrough deferred to TASK-008 release gate per phase plan.

### Task: [TASK-004] Cluster C4 — footer version + Curious Mind audit

- **Status:** 🟢 done (test, typecheck, lint, build green; walkthrough deferred to TASK-008)
- **Priority:** P2
- **Parallel:** yes
- **Assigned:** TASK-004 Agent (Opus 4.7)
- **Depends on:** -
- **Skills:** -
- **Covers:** D5, D4
- **Files:**
  - `apps/demo/src/components/Layout.tsx`
  - `apps/demo/src/components/Layout.test.tsx` (new)
  - `apps/demo/jest.config.cjs` (new — Jest scaffold for demo)
  - `apps/demo/test/setup.ts` (new — jest-dom matchers)
  - `apps/demo/package.json` (added test deps + script)
  - `apps/demo/tsconfig.json` (added jest types)
  - `workers/api/src/rules/evaluator.test.ts`
- **Subtasks:**
  - [x] test: `Layout.test.tsx` — footer version matches `package.json` version (2 tests passing)
  - [x] test: `evaluator.test.ts` — Curious Mind matches only `genre === "documentary"` (4 regression tests passing)
  - [x] implement: wire `Layout.tsx:226` to read version from `package.json` (no `with` attribute; resolveJsonModule already on; bundle inlines value)
  - [x] implement: fix Curious Mind rule only if audit fails — **Audit verdict: PASS** (no code change needed; tests now lock the behaviour)
  - [ ] verify: walkthrough confirms footer reads `v0.1.5` after TASK-008 bump (deferred to TASK-008 release)
- **Progress Notes:**
  - 10:15 - Task created
  - 2026-05-21 11:25 - TASK-004 claimed by TASK-004 Agent. Files locked.
  - 2026-05-21 11:45 - Done. Footer wired via `import pkg from "../../../../package.json"` (4 levels up); Vite inlines `Ut="0.1.0"` in the bundle today, will inline `0.1.5` after TASK-008 bumps the root. Curious Mind audit: PASS — the eq+missing-field semantics in `filter.ts` already enforce documentary-only; 4 regression tests (match/non-match/missing-field/three-watch completion) now lock the behaviour. Scaffolded Jest in `apps/demo` (ts-jest + jsdom + jest-dom + identity-obj-proxy, mirroring `packages/react`). All verifications green: 207/207 worker-api tests, 2/2 demo tests, demo typecheck (except an unrelated TASK-001-in-flight `EventLog.tsx` error), demo build, demo lint.

### Task: [TASK-005] Cluster C5 — CI E2E gate via CF WAF rule + secret header (= old TASK-011)

- **Status:** 🟢 code-complete (awaiting manual CF dashboard + GH secret steps)
- **Priority:** P1
- **Parallel:** yes
- **Assigned:** Main Agent (Opus 4.7)
- **Depends on:** -
- **Skills:** cloudflare-naming, deploy, env-sync
- **Covers:** TASK-011 carry-over from Phase 8
- **Files:**
  - `apps/demo/playwright.config.ts`
  - `.github/workflows/deploy.yml`
  - `docs/SELF_HOSTING.md`
  - `.env.example` (N/A — no root `.env.example` in repo; token is Playwright-only, never reaches workers, so no `.dev.vars.example` entry needed either)
- **Subtasks:**
  - [ ] manual (user): `openssl rand -hex 32` → store as GH secret `CI_BOT_BYPASS_TOKEN`
  - [ ] manual (user): create CF WAF custom rule (zone `jairukchan.com`) scoped to POST /api/token + `x-questkit-ci-bypass` header → Skip SBFM + Managed Rules (see SELF_HOSTING.md §8.6 for exact expression)
  - [x] implement: `playwright.config.ts` extraHTTPHeaders gated to prod target
  - [x] implement: workflow passes `CI_BOT_BYPASS_TOKEN` to E2E step
  - [x] docs: `SELF_HOSTING.md` "CI E2E bypass" subsection (§8.6)
  - [x] env-sync: confirmed N/A — Playwright reads from process.env only; no .env.example file exists in repo root; .dev.vars.example files target wrangler workers which never see this token
  - [ ] verify: `gh workflow run deploy.yml` → E2E step green (BLOCKED on manual steps above)
- **Progress Notes:**
  - 10:15 - Task created
  - 11:15 - Started code-side implementation
  - 11:30 - Code complete: playwright.config.ts extraHTTPHeaders gated on `target === "prod" && process.env.CI_BOT_BYPASS_TOKEN`; deploy.yml E2E step now receives `CI_BOT_BYPASS_TOKEN: ${{ secrets.CI_BOT_BYPASS_TOKEN }}`; SELF_HOSTING.md §8.6 documents the full bypass flow including exact WAF rule expression, rotation procedure, and security trade-off analysis. `@questkit/demo` typecheck clean. Playwright config loads OK with env vars set (verified via `playwright test --list`). Without the manual GH secret + CF rule steps, CI E2E will still fail (expected — code side is ready; manual side is the remaining gate).

### Task: [TASK-006] B6 investigation spike — AI picks fallback rate

- **Status:** 🔴 closed — ESCALATED to Phase 10 backlog (verdict: P0 prod bug)
- **Priority:** P2 (verification-only) → P0 follow-up
- **Parallel:** yes
- **Assigned:** task-006-agent (Opus 4.7)
- **Depends on:** -
- **Skills:** -
- **Covers:** B6
- **Files:**
  - `workers/api/src/services/ai.ts` (observability — distinct reason per fallback branch + fingerprint)
  - `instruction/work/test-report.md` (verdict)
- **Subtasks:**
  - [x] verify: `curl /v1/recommendations` × 5 against prod with seed user — count `fallback: true` → **5/5 = 100%**
  - [x] implement: distinct `console.warn` per fallback branch at `ai.ts` (envelope strategy + fingerprint + ai-run-threw)
  - [x] decide: rate ≥ 80% → **ESCALATE P0, added to Phase 10 backlog**
  - [x] verify: outcome decision written into `instruction/work/test-report.md` "TASK-006 — B6 verification spike" section
- **Progress Notes:**
  - 10:15 - Task created
  - 11:25 - Spike started. Confirmed: ai.ts:307 already has `console.warn("[ai] response did not match any known envelope; falling back")`. Route at recommendations.ts:146 has a second `console.warn("[recommendations] ai binding failure, falling back", err)` for the `env.AI.run()` throw branch. Need to add distinct reasons per envelope strategy that fails and a fingerprint of the raw response when none match.
  - 11:50 - Curl × 5 against prod with 5 fresh user IDs → **5/5 fallback rate (100%)**. Above 80% escalate threshold. Verdict: ESCALATE — this is a real P0 bug, not the Phase 8 fallback "working as designed". Underlying cause unknown (likely model-id deprecation per amendment A8, or new envelope shape, or `response_format` regression). Observability instrumentation landed: `normalizeAiEnvelope` now returns `EnvelopeOutcome{strategy, fingerprint}` (value-stripped to avoid PII/prompt-injection leak), `recommendMissions` wraps `env.AI.run` in try/catch with `[ai] fallback reason=ai-run-threw …` log. All 12 existing `ai.service.test.ts` tests still green; typecheck + lint clean. Next deploy needs `wrangler tail` window so operator can identify which branch fires. Full Phase 10 backlog entry + diagnostic recipe in test-report.md.

### Task: [TASK-007] Cluster C6 — optimistic counter debounce (D3)

- **Status:** 🟢 closed (non-bug)
- **Priority:** P2
- **Parallel:** yes
- **Assigned:** TASK-007 Agent
- **Depends on:** -
- **Skills:** -
- **Covers:** D3
- **Files:**
  - ~~`packages/react/src/hooks/useMissions.ts`~~ (no change needed — see verdict)
  - `packages/react/test/hooks/useMissions.test.tsx` (regression test added)
- **Subtasks:**
  - [x] test: non-qualifying `mission.progress` event does NOT bump optimistic counter — added under `describe("optimistic updates from fireEvent (no SSE)")`, green
  - [x] implement: ~~1.5s debounce~~ — **not required.** Verdict below.
  - [x] verify: contract pinned by the new regression test; 5-buy mixed-category manual walkthrough deferred to TASK-002 walkthrough (still in plan)
- **Verdict (D3 is a non-bug):**
  - Server-side rule engine (`workers/api/src/rules/index.ts :: evaluateEvent`) only returns missions whose `evaluate()` returned `matched: true` (event name + filter + window + expiry all pass).
  - `/v1/events` route forwards `updated.map(p => p.missionId)` as `missionsUpdated`.
  - SDK (`packages/core/src/client.ts :: buildSendFn`, line 407) passes that server-filtered array straight to `onFireEventSuccess` listeners — no local fan-out.
  - Hook's existing for-loop in `useMissions.ts:143` only bumps IDs explicitly listed → non-qualifying missions are structurally unreachable. No debounce timer required.
- **Progress Notes:**
  - 10:15 - Task created
  - 11:35 - Read `useMissions.ts:130-178`, `client.ts:313-428`, `routes/events.ts`, `services/ingest.ts:260-268`, `rules/index.ts`, `rules/evaluator.ts`. Confirmed server-filter chain. D3 is structurally impossible. Added regression test (1 new test, passes against current source). No source edit needed → no Phase B file lock on `useMissions.ts` required. Closing as non-bug. NB: pre-existing `mission.claimed` test fails — that's TASK-001's outstanding handler work, not mine.

### Task: [TASK-008] v0.1.5 release — version bump + smoke + walkthrough

- **Status:** 🟢 DEPLOYED to prod — v0.1.5 live on `https://api.questkit.jairukchan.com` (`/v1/health` confirms `version:"0.1.5"`). Awaits user manual walkthrough + optional E2E gate unblock.
- **Priority:** P0
- **Parallel:** no (last)
- **Assigned:** Main Agent (Opus 4.7)
- **Depends on:** TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-007 (all done); TASK-006 closed as ESCALATE
- **Skills:** deploy, frontend-test, git-commit, git-push
- **Covers:** release gate for v0.1.5
- **Files:**
  - `package.json` (0.1.0 → 0.1.5)
  - `workers/api/src/index.ts` (/v1/health version 0.1.4 → 0.1.5)
  - `CHANGELOG.md` (added 0.1.5 + 0.1.4 entries — 0.1.4 was missing)
- **Subtasks:**
  - [x] implement: bump root `package.json` to `0.1.5`
  - [x] implement: bump `/v1/health` static version in `workers/api/src/index.ts` to `0.1.5`
  - [x] implement: append Phase 9 entry to `CHANGELOG.md` (also added missing Phase 8 entry for traceability)
  - [x] verify: full `pnpm typecheck` clean (14/14 tasks)
  - [x] verify: full `pnpm lint` clean (10/10 tasks)
  - [x] verify: full `pnpm test` clean (208 worker-api + 150 react + 2 demo = 360 tests, 1 pre-existing skip)
  - [x] verify: `pnpm --filter @questkit/demo build` succeeds; built bundle contains `0.1.5` (footer wiring confirmed)
  - [x] commit & push to `main` (commit `7321670`, push 12:35 — CI run `26204334507` in flight)
  - [ ] **manual (user, post-deploy):** verify `https://api.questkit.jairukchan.com/v1/health` returns `version:"0.1.5"`
  - [ ] **manual (user, post-deploy):** verify footer at `https://questkit.jairukchan.com/` reads `v0.1.5`
  - [ ] **manual (user, post-deploy):** walkthrough — re-test B1 (/ecommerce claim → coin credits + counter decrements), B3 (/streaming claim → widget reconciles), B4 (/daily claim → streak persists), B5 (/minigames → no "coin" toasts)
  - [ ] **manual (user, optional for E2E gate):** complete TASK-005 dashboard steps: 1. `openssl rand -hex 32` → GH secret `CI_BOT_BYPASS_TOKEN` 2. CF dashboard → WAF custom rule (full expression in `docs/SELF_HOSTING.md` §8.6) — without these the E2E step stays red but workers still deploy + bug fixes still land
- **Progress Notes:**
  - 10:15 - Task created
  - 12:00 - Code-side complete. Version bumps + CHANGELOG done. All test suites green. Build artifact contains `0.1.5`.
  - 12:35 - Committed `7321670`, pushed to `main`. CI run `26204334507` in flight; deploy workflow triggers on CI success.
  - 13:00 - CI `26204334507` → SUCCESS (3m47s). Deploy `26204447641` ran:
    ✅ D1 migrations applied, all 6 workers deployed (api/consumer/relay/demo/docs/playground), smoke-test green
    ❌ "Run E2E suite against live deploy" failed — EXPECTED: CF WAF rule + GH secret not yet wired (TASK-005 manual sub-steps).
    **Production verification:** `curl https://api.questkit.jairukchan.com/v1/health` returns `{"ok":true,"version":"0.1.5","commit":"dev"}` — v0.1.5 IS LIVE.
    Bug fixes B1/B3/B4/B5 + D1–D6 all shipped. B6 escalated to Phase 10. Walkthrough belongs to user (real browser + DevTools).

### Task: [TASK-009] Frontend automated walkthrough — prod v0.1.8 verification

- **Status:** 🟢 done (PASS with one Phase-10 finding — see F1 below)
- **Priority:** P0 (Phase 9 acceptance gate)
- **Parallel:** no (single browser session)
- **Assigned:** Main Agent (Opus 4.7) via frontend-test skill + Playwright MCP
- **Depends on:** TASK-001 → TASK-008 (all done)
- **Skills:** frontend-test
- **Covers:** manual walkthrough checkboxes on TASK-002 + TASK-008
- **Environment:** production — `https://questkit.jairukchan.com` + `https://api.questkit.jairukchan.com`
- **Files:**
  - `instruction/work/test-report.md` (TASK-009 section appended — see for full evidence)
  - `agent-temp/phase9-01-landing.png` … `phase9-06-minigames-ai-picks-panel.png`
- **Scenarios:**
  - [x] S1: footer reads `v0.1.8` ✅
  - [x] S2: B1 `/ecommerce` claim → balance 0→100 + card flipped + 3 SSE events ✅
  - [x] S3: B3 `/streaming` widget reconciles with mission (lockstep across 4 events incl. drama filter) ✅
  - [x] S4: B4 `/daily` streak persists after full reload (0 localStorage streak keys) ✅
  - [x] S5: B5 `/minigames` spin toast "You won: Bonus tick!" + zero "coin"/"gem" in main + balance unchanged ✅
  - [x] S6: BadgeWall FAB opens "Earned badges" panel; shows Daily Visitor ✅
  - [x] S7: AI picks populated with personalized LLM intro + 2 real picks ✅
  - [x] S8: console clean except F1 (no CSP/CORS/404/hydration/React noise) ⚠️ → F1 logged
- **New finding (logged for Phase 10):**
  - **F1:** Silent `claim_not_ready` (409) on apparent-3/3 Curious Mind claim. Server-authoritative state was 2/3 (visible in AI picks panel) while `/streaming` mirror was 3/3 (optimistic counter overshoot in multi-session resume). Demo swallows the 409 with `console.warn` only — no user-visible feedback. P2, adjacent to TASK-007 (D3 "non-bug" verdict should be reopened). Fix candidates: demo toast + refetch on 409, or worker-side error code split. **NOT a Phase 9 regression** — B1/B3/B4/B5/B6 all verified.
- **Progress Notes:**
  - 2026-05-21 13:45 - Task created. Playwright MCP tools loaded. agent-temp ready. Starting at `/ecommerce`.
  - 2026-05-21 13:55 - Walkthrough complete. 8/8 PASS (S8 has F1 noise — separately logged). Full evidence in test-report.md "TASK-009" section. Phase 9 acceptance: PASS. Awaits user disposition on F1 (defer to Phase 10 vs. hotfix as v0.1.9).

## File Lock Registry

| File                                                                     | Locked by          | Task                        | Since                  |
| ------------------------------------------------------------------------ | ------------------ | --------------------------- | ---------------------- |
| _(TASK-005 file locks released 11:30 — code complete)_                   | —                  | —                           | —                      |
| ~~`packages/types/src/sdk-update.ts`~~ released 11:45                    | ~~TASK-001 Agent~~ | TASK-001 (done)             | 2026-05-21 11:20–11:45 |
| ~~`packages/react/src/hooks/useMissions.ts`~~ released 11:45             | ~~TASK-001 Agent~~ | TASK-001 (done)             | 2026-05-21 11:20–11:45 |
| ~~`packages/react/test/hooks/useMissions.test.tsx`~~ released 11:45      | ~~TASK-001 Agent~~ | TASK-001 (done)             | 2026-05-21 11:20–11:45 |
| ~~`packages/react/test/components/MissionCard.test.tsx`~~ released 11:45 | ~~TASK-001 Agent~~ | TASK-001 (done)             | 2026-05-21 11:20–11:45 |
| ~~`workers/api/src/routes/missions.ts`~~ released 11:45                  | ~~TASK-001 Agent~~ | TASK-001 (done)             | 2026-05-21 11:20–11:45 |
| ~~`workers/api/src/routes/missions.test.ts`~~ released 11:45             | ~~TASK-001 Agent~~ | TASK-001 (done)             | 2026-05-21 11:20–11:45 |
| ~~`apps/demo/src/lib/useMissionClaim.ts`~~ released 11:45                | ~~TASK-001 Agent~~ | TASK-001 (done)             | 2026-05-21 11:20–11:45 |
| ~~`workers/api/src/services/ai.ts`~~ released 11:55                      | ~~task-006-agent~~ | TASK-006 (closed-escalated) | 2026-05-21 11:25–11:55 |
| ~~`apps/demo/src/routes/minigames.tsx`~~ released 11:30                  | ~~TASK-003 Agent~~ | TASK-003 (done)             | 2026-05-21 11:05–11:30 |
| ~~`apps/demo/e2e/minigames.spec.ts`~~ released 11:30                     | ~~TASK-003 Agent~~ | TASK-003 (done)             | 2026-05-21 11:05–11:30 |
| ~~`workers/api/test/events.route.test.ts`~~ released 11:30               | ~~TASK-003 Agent~~ | TASK-003 (done)             | 2026-05-21 11:05–11:30 |
| ~~`apps/demo/src/components/Layout.tsx`~~ released 11:45                 | ~~TASK-004 Agent~~ | TASK-004 (done)             | 2026-05-21 11:25–11:45 |
| ~~`apps/demo/src/components/Layout.test.tsx`~~ released 11:45            | ~~TASK-004 Agent~~ | TASK-004 (done)             | 2026-05-21 11:25–11:45 |
| ~~`workers/api/src/rules/evaluator.test.ts`~~ released 11:45             | ~~TASK-004 Agent~~ | TASK-004 (done)             | 2026-05-21 11:25–11:45 |
| ~~`apps/demo/src/routes/streaming.tsx`~~ released 12:30                  | ~~TASK-002 Agent~~ | TASK-002 (done)             | 2026-05-21 12:10–12:30 |
| ~~`apps/demo/src/routes/daily.tsx`~~ released 12:30                      | ~~TASK-002 Agent~~ | TASK-002 (done)             | 2026-05-21 12:10–12:30 |
| ~~`apps/demo/e2e/claim-flow.spec.ts`~~ (new) released 12:30              | ~~TASK-002 Agent~~ | TASK-002 (done)             | 2026-05-21 12:10–12:30 |
| ~~`apps/demo/e2e/daily.spec.ts`~~ released 12:30                         | ~~TASK-002 Agent~~ | TASK-002 (done)             | 2026-05-21 12:10–12:30 |
| ~~`apps/demo/e2e/streaming.spec.ts`~~ released 12:30                     | ~~TASK-002 Agent~~ | TASK-002 (done)             | 2026-05-21 12:10–12:30 |
