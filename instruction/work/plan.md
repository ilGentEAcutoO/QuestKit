# Plan: Phase 9 — v0.1.5 Bug-fix sweep + CI E2E gate

> Created: 2026-05-21 10:15
> Status: approved
> Predecessor: Phase 8 (v0.1.4) — archived at `../archive/002-phase-8-v0.1.4-demo-stability/`

## Requirements

In-scope (all derived from post-Phase-8 production smoke + Phase 8 backlog):

1. **Fix all confirmed bugs** reported during smoke-test of v0.1.4:
   - B1 (/ecommerce) — claim toast lies: shows "+100 coin" but balance does not credit, counter does not decrement
   - B3 (/streaming) — claim daily watcher → coin enters but "1/1" counter does not flip
   - B4 (/daily) — claim badge → "1/1" counter does not flip
   - B5 (/minigames) — spin + scratch toasts say coin earned, balance does not move
2. **Resolve Phase 8 polish backlog** (TASK-012): D1, D2, D3, D4, D5, D6
3. **Unblock CI Playwright E2E gate** (TASK-011): CF Bot Management blocking POST /api/token from GH runner IPs
4. **Investigate B6** (AI picks "unavailable right now"): determine if real bug or TASK-002 fallback working correctly
5. **Release as v0.1.5** — version bump, CHANGELOG, smoke, manual walkthrough

Out-of-scope:

- Wiring server-side coin reward for minigames (B5 option b — deferred to Phase 10 if desired; this phase does the honest-label fix only)
- New features
- Refactors not driven by a defect

## Architecture

### Root-cause clustering (from research)

11 reported symptoms collapse into 6 root-cause clusters. Each cluster shares fix surface, so one task per cluster instead of one per symptom.

| Cluster | Root cause                                                                                                                                                        | Defects covered |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **C1**  | API broadcasts `reward.granted` after claim, but `useMissions` only listens to `mission.progress` / `mission.completed` — phantom event with no consumer          | B1, D2          |
| **C2**  | Demo widgets (`/streaming` "Today's progress", `/daily` streak hero) use local `useState` / `localStorage` and never reconcile with server-side `MissionProgress` | B3, B4, D1      |
| **C3**  | Minigame `showToast()` claims "+N coin" but mission `reward_json` is a badge — toast lies                                                                         | B5, D6          |
| **C4**  | Hardcoded version string `v0.1.0` in `Layout.tsx`; Curious Mind rule needs audit against runtime evaluator                                                        | D5, D4          |
| **C5**  | CI runner IPs challenged by CF Bot Management on POST /api/token; manual users unaffected                                                                         | TASK-011        |
| **C6**  | Optimistic counter bumps on every `qk.*` event without rule-predicate filter; reconciles only on next SSE/refetch                                                 | D3              |

B6 (AI picks "unavailable") gets a separate investigation spike (TASK-006) — Team C verdict says non-bug but recommends verification.

### Per-cluster design

**C1 — claim broadcast (B1 + D2)**

- Add `mission.claimed` variant to `SDKUpdate` discriminated union at `packages/types/src/sdk-update.ts`
- Emit `mission.claimed` from `tryBroadcastClaim` at `workers/api/src/routes/missions.ts:213` (alongside existing `reward.granted` + `balance.changed`)
- Add handler in `useMissions` at `packages/react/src/hooks/useMissions.ts:87-128` that flips `progress[missionId].status = "claimed"` on event
- **Defense in depth:** `useMissionClaim` at `apps/demo/src/lib/useMissionClaim.ts:28` calls `refetchMissions()` after the API returns 200, guaranteeing UI converges even if SSE drops (the `waitUntil`-detached broadcast can silently drop when SSE_HUB DO is wedged)

**C2 — widget reconciliation (B3 + B4 + D1)**

- `apps/demo/src/routes/streaming.tsx:84,191-214` — derive "Today's progress" widget from `useMissions()` `mis_stream_*` progress entries instead of local `watchedToday` counter; apply `Math.min(current, target)` clamp matching `MissionCard`
- `apps/demo/src/routes/daily.tsx:62` — derive streak hero from server `MissionProgress`; remove `localStorage` `claimedToday` boolean

**C3 — minigame toast honesty (B5 + D6)**

- `apps/demo/src/routes/minigames.tsx:21-57, 93-110, 151-158` — replace `"+10 coin"` style labels with badge-progress text matching the actual `reward_json` from migration 0004 (e.g. "+1 Lucky Spinner progress" or "🏆 Badge earned!")
- Decide based on actual `reward_json` shape — surface badge name in toast for both spin slices and scratch reveals
- Goal: never claim coin amount that the server does not actually credit

**C4 — truth in advertising (D5 + D4)**

- `apps/demo/src/components/Layout.tsx:226` — read version from `package.json` via Vite's import-attribute or build-time replacement; never hardcoded
- Audit `workers/api/migrations/0002_seed_sample_data.sql:103-113` (`mis_stream_curious_mind` rule) — research says it IS filtered correctly (`{"genre":{"eq":"documentary"}}`); add regression test in `workers/api/src/rules/evaluator.test.ts` to prevent future drift

**C5 — CI E2E gate (TASK-011)**

Pick: **WAF custom rule scoped to POST /api/token + secret header** (Option A+B hybrid from Team B). Beats pure A (anyone can spam) and pure B (Better Auth /api/token is unauthenticated by design — full Access breaks real users).

- CF dashboard → Security > WAF > Custom rules → zone `jairukchan.com`:
  - Expression: `http.host eq "questkit.jairukchan.com" and http.request.method eq "POST" and http.request.uri.path eq "/api/token" and http.request.headers["x-questkit-ci-bypass"][0] eq "<secret>"`
  - Action: Skip → all Super Bot Fight Mode + Managed Rules
  - Place: First
- `apps/demo/playwright.config.ts` — add `extraHTTPHeaders: { "x-questkit-ci-bypass": process.env.CI_BOT_BYPASS_TOKEN }` gated to prod target
- `.github/workflows/deploy.yml` — pass `CI_BOT_BYPASS_TOKEN` secret to E2E step
- `docs/SELF_HOSTING.md` — append "CI E2E bypass" subsection for forks

**C6 — optimistic counter rule-aware (D3)**

- `packages/react/src/hooks/useMissions.ts:135` `onFireEventSuccess` — either (a) debounce optimistic increment by 1.5s waiting for authoritative SSE update, or (b) filter optimistic increments by client-side rule predicate
- Pick (a) — simpler, no SDK-rule coupling, eventual consistency already holds

## Security Considerations

- **C5 WAF skip rule** — gated by 32-byte hex secret stored only in CF dashboard + GitHub Actions secret. Leaked secret = bot scoring bypass on /api/token only; the upstream APP_SECRET (held by demo worker, never browser) is still required to mint a token. Rotation < 5 min: regenerate secret, update CF rule, update GitHub secret. **Acceptable.**
- **C1 `mission.claimed` SSE event** — purely read-only event broadcast over existing authenticated SSE channel. No new auth surface.
- **C2 widget refactor** — moving `/daily` streak from `localStorage` to server-derived state IMPROVES posture (one less client-trusted bit in critical UX path).
- **No new endpoints, no new dependencies, no new secrets except `CI_BOT_BYPASS_TOKEN`.**

## Test Specifications (TDD)

### Unit Tests

**`packages/react/test/hooks/useMissions.test.tsx`** (extend)

- TEST `mission.claimed` event handler flips `progress[id].status` from `"completed"` → `"claimed"` (covers C1)
- TEST non-qualifying `mission.progress` event does NOT bump optimistic counter (covers C6 / D3)

**`packages/react/test/hooks/useBalance.test.ts`** (extend)

- TEST `balance.changed` updates displayed amount when delivered after delay (regression for `waitUntil` drop scenario)

**`apps/demo/src/components/Layout.test.tsx`** (new)

- TEST footer version string matches root `package.json` version field (covers D5; prevents regression on next bump)

**`workers/api/src/rules/evaluator.test.ts`** (extend)

- TEST `mis_stream_curious_mind` rule matches `video.watched` only when `genre === "documentary"` (covers D4 audit; locks current correct behavior)

### Component Tests

**`packages/react/test/components/MissionCard.test.tsx`** (extend)

- TEST card displays "Claimed" disabled state when `progress.status === "claimed"`

### Integration Tests

**`workers/api/src/routes/missions.test.ts`** (extend)

- TEST POST /claim with healthy SSE_HUB delivers `mission.claimed` + `reward.granted` + `balance.changed` to a subscriber within 2s (covers C1 broadcast path)

**`workers/api/src/routes/minigames.test.ts`** (new — does not exist yet)

- TEST POST /v1/events with `name: "qk.minigame.spin"` returns 200 and does NOT mutate the `balances` table (locks in the no-coin-mint contract until B5(b) is intentionally wired)

### E2E Tests (Playwright)

**`apps/demo/e2e/claim-flow.spec.ts`** (new — single file covers C1 + C2)

- TEST `/ecommerce` claim → card flips to "Claimed" within 2s **without** navigation; balance widget updates within 2s
- TEST `/streaming` claim → "Today's progress" widget reflects claimed state without nav
- TEST `/daily` claim → streak hero reflects claimed state without nav

**`apps/demo/e2e/minigames.spec.ts`** (new — covers C3)

- TEST spin wheel win toast contains no "coin" substring and references the actual badge name
- TEST scratch card reveal toast contains no "coin" substring

## Tasks

### TASK-001: Cluster C1 — `mission.claimed` SSE event + refetch fallback

- Priority: P0 (highest — demo killer)
- Parallel: no (foundation for E2E specs in TASK-002)
- Depends on: -
- Skills: -
- Subtasks:
  - [ ] test: `useMissions.test.tsx` case for `mission.claimed` handler (red)
  - [ ] test: `MissionCard.test.tsx` case for `progress.status === "claimed"` display (red)
  - [ ] test: `missions.test.ts` integration — claim delivers all 3 SSE events within 2s
  - [ ] implement: add `mission.claimed` variant to `SDKUpdate` union in `packages/types/src/sdk-update.ts`
  - [ ] implement: emit `mission.claimed` from `tryBroadcastClaim` in `workers/api/src/routes/missions.ts:213`
  - [ ] implement: handler in `useMissions` in `packages/react/src/hooks/useMissions.ts:87`
  - [ ] implement: refetch fallback in `useMissionClaim` in `apps/demo/src/lib/useMissionClaim.ts:28`
  - [ ] verify: all green; run typecheck + lint

### TASK-002: Cluster C2 — demo widgets reconciled to server state

- Priority: P1
- Parallel: yes (after TASK-001 — uses `claimed` status)
- Depends on: TASK-001
- Skills: frontend-test
- Subtasks:
  - [ ] test: `claim-flow.spec.ts` E2E case for `/streaming` Today's progress reconciliation
  - [ ] test: `claim-flow.spec.ts` E2E case for `/daily` streak reconciliation
  - [ ] implement: derive `/streaming` "Today's progress" from `useMissions()` — `apps/demo/src/routes/streaming.tsx:84,191-214`
  - [ ] implement: derive `/daily` streak hero from `useMissions()`, drop `localStorage` — `apps/demo/src/routes/daily.tsx:62`
  - [ ] implement: apply `Math.min(current, target)` clamp consistently
  - [ ] verify: manual browser walkthrough (5 buys/watches per page, claim each, watch widget reconcile without nav)

### TASK-003: Cluster C3 — minigame toast honesty

- Priority: P1
- Parallel: yes
- Depends on: -
- Skills: frontend-test
- Subtasks:
  - [ ] test: `minigames.spec.ts` E2E — spin toast contains no "coin" substring
  - [ ] test: `minigames.spec.ts` E2E — scratch toast contains no "coin" substring
  - [ ] test: `minigames.test.ts` integration — `qk.minigame.spin` event does NOT mutate balances
  - [ ] implement: replace coin labels with badge text in `apps/demo/src/routes/minigames.tsx:21-57,93-110,151-158`
  - [ ] implement: distinguish toast types (currency vs badge) in `useDemoToast` if needed
  - [ ] verify: walkthrough confirms toast labels match actual rewards from migration 0004

### TASK-004: Cluster C4 — footer version + Curious Mind audit

- Priority: P2
- Parallel: yes
- Depends on: -
- Skills: -
- Subtasks:
  - [ ] test: `Layout.test.tsx` (new) — footer version matches `package.json`
  - [ ] test: `evaluator.test.ts` extension — Curious Mind matches only `genre === "documentary"`
  - [ ] implement: wire `Layout.tsx:226` to read from `package.json` version (Vite import attribute)
  - [ ] implement: fix Curious Mind rule IF audit shows mismatch (research says it's correct; expect test-only change)
  - [ ] verify: walkthrough confirms footer reads correct version after `package.json` bump in TASK-008

### TASK-005: TASK-011 carry-over — CI E2E gate via CF WAF rule + secret header

- Priority: P1 (gates regression detection for all future phases)
- Parallel: yes
- Depends on: -
- Skills: cloudflare-naming, deploy, env-sync
- Subtasks:
  - [ ] manual: `openssl rand -hex 32` → store as `CI_BOT_BYPASS_TOKEN` in GitHub Actions secrets + local `.env`
  - [ ] manual: create CF WAF custom rule in dashboard (zone `jairukchan.com`) — scoped to POST /api/token + `x-questkit-ci-bypass` header → Skip SBFM
  - [ ] implement: `apps/demo/playwright.config.ts` — `extraHTTPHeaders` gated to prod target
  - [ ] implement: `.github/workflows/deploy.yml` — pass `CI_BOT_BYPASS_TOKEN` to E2E step
  - [ ] docs: `docs/SELF_HOSTING.md` — append "CI E2E bypass" subsection
  - [ ] env-sync: update `.env.example` / `.dev.vars.example` if needed
  - [ ] verify: trigger `gh workflow run deploy.yml` — E2E step green; without header from CI = still 403 (rule scoped correctly)

### TASK-006: B6 investigation spike — AI picks fallback rate

- Priority: P2 (verification-only; may close as "non-bug" or escalate)
- Parallel: yes
- Depends on: -
- Skills: -
- Subtasks:
  - [ ] verify: `curl https://api.questkit.jairukchan.com/v1/recommendations` × 5 with seeded test user — count `fallback: true` responses
  - [ ] implement: add `console.log("[ai] fallback", { reason })` at `workers/api/src/services/ai.ts:307` (or 1-line observability counter to KV / DO)
  - [ ] decide: if fallback rate < 20% → close as "non-bug, TASK-002 working as designed"; if ≥ 80% → escalate as P0 bug, document upstream issue, add to Phase 10 backlog
  - [ ] verify: deploy + 1-day rate observation OR immediate curl-based verdict

### TASK-007: Cluster C6 — optimistic counter debounce (D3)

- Priority: P2
- Parallel: yes
- Depends on: -
- Skills: -
- Subtasks:
  - [ ] test: `useMissions.test.tsx` extension — non-qualifying event does not bump optimistic counter immediately
  - [ ] implement: 1.5s debounce on optimistic increment in `packages/react/src/hooks/useMissions.ts:135`
  - [ ] verify: variety pack 5-buy mixed-category scenario — counter shows correct count, no flicker

### TASK-008: v0.1.5 release — version bump, CHANGELOG, smoke, walkthrough

- Priority: P0
- Parallel: no (must be last)
- Depends on: TASK-001, TASK-002, TASK-003, TASK-004, TASK-005, TASK-007 (TASK-006 may be in-flight)
- Skills: deploy, frontend-test, git-commit, git-push
- Subtasks:
  - [ ] implement: bump root `package.json` to `0.1.5`
  - [ ] implement: bump worker `wrangler.jsonc` version metadata if present
  - [ ] implement: update `CHANGELOG.md` with Phase 9 entry
  - [ ] commit & push → CI green (all 3 jobs + E2E now green from TASK-005)
  - [ ] verify: manual browser walkthrough on prod — re-run 10-row matrix from Phase 8 test-report PLUS regression check on B1, B3, B4, B5
  - [ ] verify: `/v1/health` returns `version: "0.1.5"`
  - [ ] verify: footer reads `v0.1.5` (TASK-004 wiring)

## Execution order suggestion

1. TASK-001 first (foundation — P0)
2. TASK-002 (depends on 001) + TASK-003 + TASK-004 + TASK-005 + TASK-006 + TASK-007 in parallel
3. TASK-008 last (version bump + release verification)
