# Active Tasks

> Last updated: 2026-05-19 21:45 (**Phase 3 in progress** — TASK-014 🟢, TASK-015 🟢, TASK-016 🟢 (109/109 tests, 93% line cov), TASK-017 🟢 (168/168 worker tests incl. 15 new for AI svc+route; 123/123 react tests incl. 14 new for hook+component), TASK-018 🟢. Next: TASK-019 (closes Phase 3). Phase 2 SHIPPED — TASK-006..013 all 🟢. Worker deployed Version `56a4784b-0399-4e7a-9947-9c6bff3bc468`. **Pending user action:** register `QUESTKIT_APP_SECRET` in GitHub repo secrets so Newman job can authenticate. Value = same `APP_SECRET` set via `wrangler secret put` in TASK-005.)
> Source plan: [`./plan.md`](./plan.md)
> Source spec: [`../instruction.md`](../instruction.md)
> Total: 34 tasks across 6 phases. **Plan status: approved.** Run `/workflow-work` to start execution.

---

## Phase 1 — Foundation (Day 1)

### Task: [TASK-001] Monorepo scaffold

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no (blocks everything)
- **Assigned:** scaffold-teammate
- **Depends on:** -
- **Skills:** `cloudflare-naming` (for `package.json` `name`), `env-sync` (creates `.dev.vars.example` template)
- **Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierignore`, `.nvmrc`, `.gitignore`, `.gitattributes`
- **Subtasks:**
  - [x] implement: root `package.json` (private, `packageManager: pnpm@10.27.0`, workspace scripts, dev-deps only)
  - [x] implement: `pnpm-workspace.yaml` with `apps/* packages/* workers/*` + `catalog:` (TS 5.8.3, React 18.3.1, Vite 7, Vitest 3.2, tsdown 0.6, Hono 4.6, etc.) + `minimumReleaseAge: 1440`
  - [x] implement: `turbo.json` with `tasks` schema (build/test/lint/typecheck/dev/deploy)
  - [x] implement: `tsconfig.base.json` strict + `verbatimModuleSyntax` + `moduleResolution: bundler` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`
  - [x] implement: `eslint.config.js` flat with `@antfu/eslint-config` (TS + React + formatting)
  - [x] implement: `.nvmrc = 20`, `.gitignore` (per spec §11), `.gitattributes` (LF line endings cross-platform)
  - [x] implement: empty workspace folders `apps/{demo,docs,playground}`, `packages/{types,core,react,embed}`, `workers/{api,webhook-relay,webhook-consumer}` with placeholder `package.json` each
  - [x] verify: `pnpm install` succeeds from clean clone (resolved 384, 355 added, 20.5s; frozen-lockfile re-install: "Already up to date")
  - [x] verify: `pnpm lint`, `pnpm typecheck` run (zero failures on empty workspace — both exit 0, "no tasks were executed" as expected since placeholders have no scripts yet)
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 09:30 — Implementation complete. 9 root files + 10 placeholder `package.json` files created. `pnpm install` resolved 384 packages, 355 added; `pnpm-lock.yaml` (116 KB) generated and verified reproducible via `--frozen-lockfile`. `pnpm lint` exit 0. `pnpm typecheck` exit 0. Resolved versions: `@antfu/eslint-config` 3.16.0 (catalog `^3.10.0`), `eslint` 9.39.4, `turbo` 2.9.14, `typescript` 5.8.3 (exact pin), `prettier` 3.8.3, `rimraf` 6.1.3. One benign warning: pnpm noted `unrs-resolver@1.11.1` ignored its postinstall build script — not needed for our use, can be enabled later via `pnpm approve-builds` if any teammate hits a missing native binary. No real CF resource IDs, secrets, or accounts committed. File locks released.

---

### Task: [TASK-002] `@questkit/types` package

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** yes (with TASK-003)
- **Assigned:** types-builder
- **Depends on:** TASK-001
- **Skills:** (type-only — no UI/CF triggers)
- **Files:** `packages/types/{package.json,tsconfig.json,tsdown.config.ts,src/index.ts,src/{event,mission,reward,balance,campaign,sdk-update}.ts}`
- **Subtasks:**
  - [x] implement: paste types verbatim from spec §3 — `Event`, `Mission`, `MissionCriteria`, `FilterClause`, `Reward`, `CurrencyCode`, `MissionProgress`, `Balance`, `Campaign`, `CampaignTheme`, `SDKUpdate` (discriminated union)
  - [x] implement: split into one file per domain concept, re-export from `src/index.ts`
  - [x] implement: tsdown config (`format: ['esm','cjs']`, `dts: true`)
  - [x] verify: `pnpm --filter @questkit/types build` produces ESM+CJS+`.d.ts`
  - [x] verify: `tsc --noEmit` clean (this IS the unit test for type packages)
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 10:35 — implemented. Created 6 src files (event/mission/reward/balance/campaign/sdk-update) + index.ts barrel using `export type *`; package.json with dual ESM/CJS exports map + `sideEffects: false`; tsconfig extends base; tsdown.config.ts with `fixedExtension: false` so output is `.js`/`.cjs`/`.d.ts`/`.d.cts`. **Catalog bump:** had to raise `tsdown` in `pnpm-workspace.yaml` from `^0.6.0` to `^0.22.0` — tsdown 0.6.10 pinned `rolldown: ^1.0.0-beta.7` but with `minimumReleaseAge: 1440` we resolved to stable `rolldown@1.0.1` which removed the `transformPlugin` experimental export tsdown 0.6.10 imported (`SyntaxError` at startup). tsdown 0.22.0 declares `rolldown: ^1.0.0` properly and uses `rolldown-plugin-dts`. **Verification:** `pnpm --filter @questkit/types build` → 6 dist files (index.js 11 B, index.cjs 0 B since pure types, index.d.ts 2.24 kB, index.d.cts 2.24 kB, plus .map files); `pnpm --filter @questkit/types typecheck` → exit 0; CJS load `node -e "const t = require('./dist/index.cjs'); console.log('cjs ok')"` → prints `cjs ok`; all 11 expected exports present in `dist/index.d.ts` final line (`Balance, Campaign, CampaignTheme, CurrencyCode, Event, FilterClause, Mission, MissionCriteria, MissionProgress, Reward, SDKUpdate`). **Note for downstream:** `pnpm lint` fails on a pre-existing TASK-001 eslint config issue (`@antfu/eslint-config` interactive prompt for react packages crashes in non-TTY) — not introduced by this task, but blocks `pnpm lint`. Worth a follow-up on the lint config. File locks released.

---

### Task: [TASK-003] `questkit-worker-api` skeleton

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** yes (with TASK-002)
- **Assigned:** api-skeleton
- **Depends on:** TASK-001
- **Skills:** `cloudflare-naming`, `env-sync`
- **Files:** `workers/api/{package.json,wrangler.jsonc,src/index.ts,src/env.d.ts,tsconfig.json,.dev.vars.example,README.md}`, `.dev.vars.example`, `.gitignore` (negation line only)
- **Subtasks:**
  - [x] implement: `wrangler.jsonc` per plan §2.3 with name=`questkit-worker-api`, all bindings as placeholders, compat date `2026-05-19`, observability on
  - [x] implement: Hono app with single route `GET /v1/health` → `{ ok: true, version: "0.1.0", commit: <build env> }`
  - [x] implement: TypeScript Env type via `wrangler types` output → committed `worker-configuration.d.ts` (gitignored per spec §11 — contributors run `pnpm cf-typegen` after install)
  - [x] implement: error handler middleware (`app.onError`)
  - [x] implement: `.dev.vars.example` with `JWT_SECRET=`, `WEBHOOK_HMAC_SECRET=`, `APP_SECRET=` + `# generate: openssl rand -base64 48` comments (both at repo root and in `workers/api/`)
  - [x] verify: `wrangler dev` serves `/v1/health` → 200 locally (`{"ok":true,"version":"0.1.0","commit":"dev"}`)
  - [x] verify: `wrangler deploy --dry-run` succeeds (63.10 KiB / 15.30 KiB gzip; all 8 bindings recognised)
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 10:15 — Implementation complete. `workers/api/package.json` expanded with `dev`/`deploy`/`typecheck`/`lint`/`test`/`cf-typegen` scripts, deps `hono` + `@questkit/types` (workspace), devDeps wrangler/vitest-pool-workers/workers-types/typescript/vitest. `wrangler.jsonc` matches plan §2.3 exactly: all 8 bindings (D1=DB, KV=CACHE, R2=ASSETS_R2, Queue producer=WEBHOOK_QUEUE, 2 DOs RATE_LIMITER+SSE_HUB with `new_sqlite_classes` migration tag v1, AE=EVENTS_AE, AI=AI), placeholder IDs `<set-per-env>`, observability on. `src/index.ts` Hono app with `/v1/health` + `onError` + stub `RateLimiter` / `SSEHub` DO classes (chose option (a) per task spec so wrangler config matches plan §2.3 verbatim). `src/env.d.ts` augments `Env` with `GIT_SHA?` + 3 secret string types because wrangler-generated d.ts doesn't infer secrets yet. `tsconfig.json` extends base, `noEmit: true`, `types: ["@cloudflare/workers-types/2023-07-01"]`. `worker-configuration.d.ts` regenerated (508 KB, gitignored — runtime types now embedded in same file per wrangler 4.92's new behaviour). Verifications: `pnpm install` ✅ (+115 packages), `pnpm cf-typegen` ✅, `pnpm typecheck` exit 0, `curl /v1/health` 200 + correct JSON, `wrangler deploy --dry-run` exit 0 with all bindings, `pnpm test --passWithNoTests` exit 0. File locks released.
  - **Decisions flagged (read before TASK-005 / TASK-001 follow-up):**
    - (a) Added `!.dev.vars.example` negation to root `.gitignore` (single line) — without it, `.dev.vars.*` would have ignored my deliverable. Touching TASK-001's file but no other safe option; logged in lock registry.
    - (b) Catalog version drift: `@cloudflare/vitest-pool-workers@0.6.x` (catalog) requires `vitest@2.0.x–2.1.x` but catalog pins `vitest@^3.2.0` → pnpm peer-dep warning (non-fatal; tests pass with `--passWithNoTests`). Latest pool-workers `0.16.6` needs vitest 4.x. Suggest TASK-001 update catalog to a compatible pair before TASK-007/008 writes real Worker tests.
    - (c) `pnpm lint` from a subagent shell crashes with `ERR_TTY_INIT_FAILED` because `@antfu/eslint-config` prompts to install React/etc. plugin packages on first run (ESLint config has `react: true`). CI with `CI=1` is unaffected. Tracked for TASK-004 (which owns CI) — they can add `CI=1` to lint script or pre-install the missing peer plugins.
    - (d) Wrangler 4.92 now emits runtime types inline in `worker-configuration.d.ts` and advises removing `@cloudflare/workers-types` from tsconfig. Kept the explicit `types: [...]` pin for now (typecheck passes); can be cleaned up in Phase 2.

---

### Task: [TASK-004] Public-repo hygiene

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** yes (with TASK-002, TASK-003 — no file overlap)
- **Assigned:** hygiene-builder (partial) + team-lead (completion)
- **Depends on:** TASK-001
- **Skills:** `git-commit` (verify no AI signature)
- **Files:** `LICENSE`, `README.md` (stub), `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`, `.github/{workflows/ci.yml,ISSUE_TEMPLATE/{bug_report,feature_request}.md,PULL_REQUEST_TEMPLATE.md,dependabot.yml}`, `.husky/pre-commit`, `gitleaks.toml`, `sonar-project.properties`, root `package.json` (husky + lint-staged additions)
- **Subtasks:**
  - [x] implement: MIT `LICENSE` (year 2026, author Bosso / ilGentEAcutoO)
  - [x] implement: README stub (full version in Phase 6 — TASK-033) with project name, one-line tagline, "Under construction" banner, link to plan
  - [x] implement: `CONTRIBUTING.md` (clone → install → dev → test → commit conventions → PR process)
  - [x] implement: `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 by reference + summary — see Progress Notes)
  - [x] implement: `SECURITY.md` (supported versions table, disclosure email, response time SLA)
  - [x] implement: `.github/workflows/ci.yml` — node 20, pnpm setup, install → lint → typecheck → test → gitleaks → pnpm audit
  - [x] implement: `.github/ISSUE_TEMPLATE/` two templates (bug, feature)
  - [x] implement: `.github/PULL_REQUEST_TEMPLATE.md` (description, tests, breaking changes checkbox)
  - [x] implement: `.github/dependabot.yml` (npm weekly + github-actions weekly + ignored majors for React peerDeps)
  - [x] implement: `.husky/pre-commit` running `pnpm lint-staged` + `pnpm exec gitleaks detect --staged`
  - [x] implement: `gitleaks.toml` (default rules + repo-specific allowlist for `.dev.vars.example` placeholder values + `instruction/*.md`)
  - [x] implement: `sonar-project.properties` (project key, organization, source/test paths, exclusions for `dist/**`, `**/*.test.ts`)
  - [ ] verify: CI runs green on first push (deferred to TASK-005 push — cannot verify until repo is pushed to GitHub)
  - [x] verify: `gitleaks detect` returns 0 hits (locally: gitleaks binary not installed on this Windows machine — will run via `gitleaks-action@v2` in CI on first push; gitleaks.toml allowlist covers all placeholder files; manually reviewed all committed files for real secrets — none present)
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 11:00 — Partial completion by `hygiene-builder` agent (LICENSE, README.md, CONTRIBUTING.md), then content-filter halt likely on Contributor Covenant 2.1 verbatim text. Team lead (main agent) completed the remaining 11 files directly: CODE*OF_CONDUCT.md (adopted by reference rather than verbatim — links to <https://www.contributor-covenant.org/version/2/1/code_of_conduct/> with a short positive-standards summary), SECURITY.md, CHANGELOG.md, all 4 .github/ files, .github/dependabot.yml, gitleaks.toml, sonar-project.properties, .husky/pre-commit, and root package.json (added `husky`/`lint-staged` devDeps + `prepare` script + top-level `lint-staged` config for prettier+eslint). `pnpm install` succeeded (+husky 9.1.7, +lint-staged 15.5.2); husky pre-commit hook registered (`.husky/*/pre-commit`present). **Flagged placeholders to update before launch:**`security@questkit.dev`and`conduct@questkit.dev` are placeholder addresses — user should set up the inboxes or substitute real addresses before going public. File locks released.

---

### Task: [TASK-005] Deploy api Worker + custom-domain wiring

- **Status:** 🟢 completed (deploy-workers.yml CI matrix deferred to TASK-030)
- **Priority:** high
- **Parallel:** no (closes Phase 1)
- **Assigned:** team-lead (user override "you set all wrangler นะ" — main agent drove the wrangler steps)
- **Depends on:** TASK-002, TASK-003, TASK-004
- **Skills:** `cloudflare-naming`, `deploy`, `git-push`, `superpowers:verification-before-completion`
- **Files:** `workers/api/wrangler.dev.jsonc` (real IDs + routes — gitignored), `.husky/pre-commit` (gitleaks fallback), `packages/types/package.json` (unrun devDep fix)
- **Subtasks:**
  - [x] user-already-done: `wrangler login` (suanwin.paows@gmail.com / SORNKan Co., Ltd. account `a24ce30584273b42333051f1cdec48e2`)
  - [x] team-lead-ran: `wrangler d1 create questkit-d1-main` → ID `b0d9505b-52c5-499b-9251-e02dd902daea` (APAC)
  - [x] team-lead-ran: `wrangler kv namespace create questkit-kv-cache` → ID `e8a8b52a5b3a472ab5b3af1d9946e2a7`
  - [x] team-lead-ran: `wrangler r2 bucket create questkit-r2-assets`
  - [x] team-lead-ran: `wrangler queues create questkit-queue-webhooks` → ID `bba57ab310f34507b3ee78b58234f948`
  - [x] team-lead-ran: `wrangler queues create questkit-queue-webhooks-dlq` → ID `c540a829e5dc4bbaa4a7d3f965ec6174`
  - [x] team-lead-ran: created `workers/api/wrangler.dev.jsonc` (gitignored) with real D1+KV IDs and `routes: [{pattern: "api.questkit.jairukchan.com", custom_domain: true}]`
  - [x] team-lead-ran: `openssl rand -base64 48 | wrangler secret put NAME --name questkit-worker-api` for JWT_SECRET, WEBHOOK_HMAC_SECRET, APP_SECRET (values piped via stdin, never echoed)
  - [ ] implement: GitHub Actions secrets for CI deploy (D1 id, KV id, account id, API token) — **deferred to TASK-030** (Phase 6 multi-Worker deploy)
  - [ ] implement: `deploy-workers.yml` matrix — **deferred to TASK-030**
  - [x] deploy: `wrangler deploy --config workers/api/wrangler.dev.jsonc` → 63.10 KiB / 15.30 KiB gzip; Version `9505452b-ed68-437f-b503-5adf36c722be`; all 8 bindings recognized
  - [x] verify: `curl https://api.questkit.jairukchan.com/v1/health` → 200 in 170 ms, `{"ok":true,"version":"0.1.0","commit":"dev"}`
  - [x] custom-domain (CLI, not Dashboard): wrangler auto-provisioned `api.questkit.jairukchan.com` because zone is on same CF account; TLS cert ready in ~150 s
  - [x] commit + push: 2 commits — `c05a4a7 chore: scaffold monorepo and public-repo hygiene` + `1a0885c fix(types): add unrun devDep so tsdown can load .ts config in CI`. CI green on 1a0885c (all 6 steps).
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 11:30 — User override turned this into a Claude-driven task. Sequence: `wrangler whoami` confirmed auth → 5 resources created via wrangler CLI → wrangler.dev.jsonc (gitignored) generated with real IDs + routes block (`custom_domain: true`) → 3 secrets piped to `wrangler secret put` via openssl stdin (values never echoed to transcript) → `wrangler deploy --config wrangler.dev.jsonc` succeeded → CI failed on first push because tsdown 0.22 needs an optional `unrun` peer that `minimumReleaseAge: 1440` filtered out → added `unrun ^0.3.0` to `packages/types` devDeps, pushed fix, **CI green**. Custom domain self-provisioned because `jairukchan.com` zone is on the same CF account; TLS cert took ~150 s. **Resource UUIDs captured above** for TASK-031 (CLOUDFLARE_SETUP.md) and TASK-030 (CI deploy workflow). **Flags for follow-up:** (1) GitHub flagged 14 dependabot vulnerabilities (4 high / 6 mod / 4 low) on fresh install — most will resolve via dependabot PRs over the coming week; (2) Node 20 actions deprecated June 2026 — bump pnpm/action-setup + actions/setup-node to Node 24-compatible versions in TASK-029 or earlier; (3) `workers.dev` fallback URL no longer serves (disabled when custom domain attached) — production URL is now `https://api.questkit.jairukchan.com` only; (4) `routes` block lives in wrangler.dev.jsonc only — Phase 6 TASK-031 (CLOUDFLARE_SETUP.md) should formalize this pattern for forkers.

---

## Phase 2 — Core SDK + API (Day 2)

### Task: [TASK-006] D1 schema + migrations

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no (blocks routes)
- **Assigned:** d1-schema-builder (sub-agent, Opus 4.6) — design contribution by user (seed mission set: "Maximum coverage")
- **Depends on:** TASK-005
- **Skills:** `cloudflare-naming`
- **Files:** `workers/api/migrations/0001_init.sql` (178 LOC), `workers/api/migrations/0002_seed_sample_data.sql` (137 LOC), `workers/api/src/db/schema.ts` (530 LOC), `workers/api/package.json` (+4 db scripts)
- **Subtasks:**
  - [x] implement: `0001_init.sql` — 8 tables (`users`, `missions`, `campaigns`, `campaign_missions`, `mission_progress`, `balances`, `events`, `webhooks`); composite PKs for `mission_progress(user_id, mission_id)` and `balances(user_id, currency)`; `CHECK` constraints on enum-like status columns; FK declarations inline (D1 leaves enforcement off by default but declares the relationships for documentation).
  - [x] implement: 13 named indexes — all required ones from brief plus 6 cheap-and-useful additions flagged by agent (`idx_users_created_at`, `idx_campaigns_window`, `idx_events_name_ts`, `idx_progress_mission`, `idx_campaign_missions_mission`, `idx_webhooks_source_received`). Includes partial unique `idx_events_user_idem WHERE idempotency_key IS NOT NULL` as defence-in-depth alongside the primary KV idempotency cache.
  - [x] implement: `0002_seed_sample_data.sql` — 6 missions across 2 campaigns demonstrating **all** rule-engine inputs: windows {daily×2, weekly×2, lifetime×2}; filters {no-filter, eq, gte, in, gte+eq composite}; rewards {currency×4, badge×2}. IDs: `camp_{ecom,stream}_2026q2`, missions `mis_ecom_{daily_purchase_3,electronics_50,variety_week}` + `mis_stream_{daily_watch_1,documentary_3,longform_week}`. `INSERT OR REPLACE` so re-running the seed file persists tweaks.
  - [x] implement: `db/schema.ts` typed helpers — 13 functions (`rowTo*` parsers + `getMission`, `listMissions` with opaque base64url cursor pagination, `getCampaign`/`listCampaigns` hydrating `missionIds` via `GROUP_CONCAT`, `getProgress`/`listProgressForUser`/`upsertProgress`, `insertEvent`/`recentEventsForUser`, `getBalance`/`listBalances`/`adjustBalance` via `INSERT ... ON CONFLICT DO UPDATE`). **All queries are `db.prepare(sql).bind(...)` with zero user-value string concatenation** (only WHERE-clause shape templated via positional placeholders `?N`).
  - [x] apply local: `pnpm --filter @questkit/worker-api db:migrate:local` → 22 + 9 commands applied.
  - [x] apply remote: `pnpm --filter @questkit/worker-api db:migrate:remote` → 22 cmds (2.91 ms) + 9 cmds (1.26 ms), DB now 151,552 bytes, served from APAC/SIN.
  - [x] verify: `SELECT COUNT(*) FROM missions` (remote) → 6 ✅; `SELECT COUNT(*) FROM campaigns` (remote) → 2 ✅; `SELECT COUNT(*) FROM campaign_missions` (remote) → 6 ✅; window distribution `daily:2, weekly:2, lifetime:2` ✅; `tsc --noEmit` exit 0 ✅; `eslint .` 0 errors ✅.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 12:10 — Implementation complete by `d1-schema-builder` sub-agent (Opus 4.6). Seed mission spec was a user contribution under learning-mode (chose "Maximum coverage" — every mission demonstrates a distinct rule-engine input combination, ensuring the demo exercises the full FilterClause × Window matrix). **Key decisions flagged by agent (read before TASK-007/008):** (a) `users` table is minimal — TASK-007 should `INSERT OR IGNORE INTO users` on first JWT mint so FK targets exist before `mission_progress`/`balances`/`events` rows reference them; (b) idempotency is two-layered — KV cache (primary, 24h, TASK-008) + partial unique index `idx_events_user_idem` (defence-in-depth); TASK-008 should treat a `UNIQUE constraint failed` insert as equivalent to a KV cache hit, not crash; (c) `Campaign.missionIds` is rebuilt from the junction table via `GROUP_CONCAT` — runtime mission-to-campaign changes must write to **both** `missions.campaign_id` and `campaign_missions`; (d) `adjustBalance` returns the resulting `Balance` (not void) so `/v1/missions/:id/claim` in TASK-010 can broadcast `balance.changed` without a second `getBalance` round-trip; (e) `balances.amount` is `INTEGER` (whole-unit coins/points/gems); if fractional currency ever needed, migration required. **Non-blocking lint warning** (`MODULE_TYPELESS_PACKAGE_JSON` on root `eslint.config.js`) is pre-existing and unrelated to this task — flagged for later cleanup. File locks released.

---

### Task: [TASK-007] JWT auth + `/v1/auth/token`

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no
- **Assigned:** jwt-auth-builder (sub-agent, Opus 4.6)
- **Depends on:** TASK-006
- **Skills:** `superpowers:test-driven-development`
- **Files:** `workers/api/src/auth/{jwt.ts (202 LOC), middleware.ts (97 LOC)}`, `workers/api/src/routes/auth.ts` (128 LOC), `workers/api/test/{jwt.test.ts (110 LOC), auth.route.test.ts (142 LOC), setup.ts (25 LOC), env.d.ts (11 LOC)}`, `workers/api/vitest.config.ts` (87 LOC); modified `workers/api/{src/index.ts, src/db/schema.ts (+ensureUser), src/env.d.ts, tsconfig.json, package.json}` and `pnpm-workspace.yaml` (catalog bump)
- **Subtasks:**
  - [x] catalog bump: `vitest: ^3.2.0` → `^4.1.6`, `@cloudflare/vitest-pool-workers: ^0.6.0` → `^0.16.6` (matched pair; both pass `minimumReleaseAge: 1440` gate). Added `@vitest/coverage-istanbul ^4.1.6` (pool-workers prohibits v8 provider) and `@types/node` (vitest config uses `node:path`).
  - [x] test-first: `jwt.test.ts` — 7 tests covering sign+verify round-trip, expired rejection, tampered-sig rejection, wrong-secret rejection, malformed-structure rejection, malformed-payload rejection. All paths returning typed `JwtError({code:"expired"|"invalid_signature"|"malformed"})`.
  - [x] implement: `jwt.ts` — pure Web Crypto HMAC-SHA256. `sign({sub, iat, exp, jti})` and `verify(token)`. JTI generated via `crypto.getRandomValues(16 bytes)` hex-encoded. Constant-time signature verify is delegated to `crypto.subtle.verify` (spec-guaranteed timing-safe; no hand-rolled XOR loop needed).
  - [x] implement: `middleware.ts` — `requireAuth()` Hono middleware factory + `denyToken(env, jti, expSec)` helper. NOT wrapping `hono/jwt` — used our own `jwt.ts` for full control over the KV denylist check (`c.env.CACHE.get(\`jti:${payload.jti}\`)`). Middleware sets `c.set("userId", payload.sub)` so handlers get a typed userId.
  - [x] test-first: `auth.route.test.ts` — 8 tests + 1 `it.todo` (denylist real-test deferred to TASK-008 because we'd otherwise have to ship a fake `/v1/_dev/whoami` fixture only to delete it). Covers: 200 happy path with valid `{appId, appSecret, userId}` + `expiresAt - now ∈ [3590e3, 3600e3]`; 401 on wrong appSecret (returns `{error:"invalid_credentials"}` — does NOT differentiate "wrong appId" from "wrong secret" to prevent app enumeration); 400 on missing fields; round-trip `verify(token, env.JWT_SECRET)` returns correct `sub`; D1 `users` row exists after mint (verifies `ensureUser` INSERT OR IGNORE worked).
  - [x] implement: `routes/auth.ts` — `POST /v1/auth/token` route mounted at `app.route("/v1/auth", authRouter)` in `index.ts`. **Timing-safe APP_SECRET comparison via `crypto.subtle.verify` over HMAC-SHA256 with a per-request random key** (workerd lacks `crypto.subtle.timingSafeEqual`; HMAC-verify path is spec-guaranteed timing-safe and easier to audit). Returns `{ token, expiresAt: exp * 1000 }` (ms epoch).
  - [x] verify: vitest-pool-workers → **15 passed | 1 todo, 2 test files, 8.77s**. Coverage: **jwt.ts 95% lines, 100% functions, 88.88% branches** (target was > 80% ✅). routes/auth.ts 100% lines. middleware.ts 0% (deferred — TASK-008 will mount + exercise it). typecheck exit 0. eslint exit 0. `wrangler deploy --dry-run --config wrangler.dev.jsonc` → 66.52 KiB / 16.45 KiB gzip, all 8 bindings recognised.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 12:55 — Implementation complete by `jwt-auth-builder` sub-agent (Opus 4.6). **Decisions flagged for TASK-008/010 follow-up:** (a) D1 migration loading at test time — `readD1Migrations` is Node-only so the agent reads+parses in `vitest.config.ts` (Node side), passes via a `QK_D1_MIGRATIONS_JSON` miniflare binding, then `test/setup.ts` calls `applyD1Migrations`. **TASK-008 should use the same pattern for any new test setup data** (vitest's `provide`/`inject` doesn't cross the workerd boundary in pool-workers 0.16). (b) Pool-workers 0.16 removed `defineWorkersProject` — config now uses `defineConfig({plugins:[cloudflareTest({...})]})`. (c) `denyToken(env, jti, expSec)` is plumbed but no `/v1/auth/logout` route is exposed yet — design choice: rely on 1h token expiry as the primary revocation mechanism; the plumbing is ready if Phase 6 adds explicit logout. (d) `ensureUser(db, userId)` was added to `src/db/schema.ts` (per TASK-006 note (a)) — **TASK-008's `/v1/events` should also call it** defensively (no-op after `/v1/auth/token` but cheap). (e) `Cloudflare.Env` augmentation mirrored in `src/env.d.ts` because pool-workers types `env: Cloudflare.Env`, not global `Env`. (f) Cosmetic "remote connection close timed out" warning at end of every test run comes from the unused AI binding; suppress by adding `remote: true` to the AI binding when TASK-017 wires it in. (g) Test secrets (`test_jwt_secret_do_not_use_in_prod_…` etc.) are obviously-fake and committed in `vitest.config.ts` — these are NOT real secrets and the gitleaks allowlist already covers `*.test.*` paths. **TASK-008 instructions:** import `{ requireAuth }` from `../auth/middleware` then `app.use("/v1/events/*", requireAuth())` before route handlers; convert the `it.todo` denylist placeholder in `auth.route.test.ts` to a real test that mints → denies → hits `/v1/events` and expects 401 `token_revoked`. File locks released.

---

### Task: [TASK-008] `/v1/events` ingestion + idempotency + Analytics Engine

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** yes (with TASK-009)
- **Assigned:** events-route-builder (team teammate B, Opus 4.6) — concurrent with rule-engine-builder
- **Depends on:** TASK-007
- **Skills:** `superpowers:test-driven-development`, `cloudflare-naming`
- **Files:** `workers/api/src/routes/events.ts` (293 LOC), `workers/api/src/services/idempotency.ts` (78 LOC), `workers/api/src/services/ae.ts` (73 LOC), `workers/api/test/events.route.test.ts` (453 LOC, 19 tests); modified `workers/api/src/index.ts` (+22 LOC mount + onError fix), `workers/api/src/db/schema.ts` (+27 LOC `getEventByIdemKey` helper), `workers/api/test/auth.route.test.ts` (converted `it.todo` → `it.skip` pointing to events.route.test.ts).
- **Subtasks:**
  - [x] test-first: events.route.test.ts — 19 tests covering 200 happy, 401 missing JWT, **401 revoked JWT (denylist test — fulfils the TASK-007 `it.todo`)**, 403 userId mismatch, 400 on missing fields, idempotency replay via header + body field + header-precedence, **D1-fallback replay** (KV evicted → UNIQUE constraint → `X-Idempotent-Replay: db-hit`), AE write spy verification, 501 rate-limiter stub → allow-with-warn.
  - [x] implement: `services/idempotency.ts` — `getCached`/`putCached` via KV with 24h TTL (`IDEMPOTENCY_TTL_SECONDS = 86400`), key shape `idem:${userId}:${idempotencyKey}` (per-user scoped, prevents cross-user collisions).
  - [x] implement: `services/ae.ts` — `writeEventDataPoint(ae, event, ctx)` — blobs `[name, userId, country, idempotencyKey]`, doubles `[1, lagMs, missionsMatched]`, indexes `[userId]`. Country sourced from `c.req.raw.cf?.country`, fallback `"unknown"`. Within AE limits (≤ 20 each, index ≤ 96 bytes — flagged userId-as-index risk in JSDoc since host-app controls userId length).
  - [x] implement: `/v1/events` route — `requireAuth` middleware → body validation → `userId === c.var.userId` enforcement (403 on mismatch, prevents cross-user event injection) → rate-limiter DO call (501 stub treated as allow with `console.warn` pointing to TASK-011) → idempotency check (KV first, falls through to D1 UNIQUE-constraint fallback path) → `ensureUser` → `insertEvent` → `evaluateEvent(db, event, candidates)` (teammate A's contract) → AE write → cache response → return `{accepted: true, eventId, missionsUpdated: updated.map(p => p.missionId)}`.
  - [x] verify: 19/19 new tests pass; full suite **101 passed, 1 skipped, 0 failed**; route coverage **92.75% lines**, services 100% / 100%; `wrangler deploy --dry-run` bundles to 85.71 KiB / 21.46 KiB gzip with all 8 bindings recognised.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 13:45 — Implementation complete by `events-route-builder` (Opus 4.6) running parallel to TASK-009. **Decisions / scope-widening flagged for review:** (a) `app.onError` modified beyond the original brief to pass through `HTTPException` via `err.getResponse()` — the original handler swallowed everything as 500 which would have blocked the auth middleware's 401 path; legitimate bug fix discovered mid-flight. (b) `getEventByIdemKey` added to `src/db/schema.ts` — needed for the D1-UNIQUE-constraint replay fallback path (the defence-in-depth layer flagged in TASK-006 note (b)). (c) `Idempotency-Key` header takes precedence over body's `idempotencyKey` field when both present (matches RFC 9530 draft + Stripe/PayPal convention). (d) On the D1-replay fallback path, response's `missionsUpdated: []` because we don't journal the rule engine's prior output — first call already broadcast updates; this replay is a true no-op. Documented as a deliberate trade-off; product can revisit if a "complete replay" is needed (would require migration to journal mission_progress deltas alongside events). (e) AE writes observed in tests via `vi.spyOn(env.EVENTS_AE, "writeDataPoint")` — pool-workers 0.16 doesn't natively replay AE, but the spy approach works because bindings are real objects on `env`. (f) Test event name `app.heartbeat` chosen for validation/idempotency tests so they don't entangle with rule-engine output; mission-match test uses `purchase.completed` explicitly. (g) Rate-limiter 501-allow fallback has explicit `console.warn` + comment pointing to TASK-011 — when the real DO lands, the warn comes out and the "501 → allow" test flips to "429 enforced". File locks released.

---

### Task: [TASK-009] Mission rule engine (TDD)

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** yes (with TASK-008)
- **Assigned:** rule-engine-builder (team teammate A, Opus 4.6) — concurrent with events-route-builder
- **Depends on:** TASK-006
- **Skills:** `superpowers:test-driven-development`
- **Files:** `workers/api/src/rules/{window.ts (93 LOC), filter.ts (151 LOC), evaluator.ts (159 LOC), index.ts (144 LOC)}` + `{window,filter,evaluator,index}.test.ts` (4 files, 911 LOC, 67 tests). No `schema.ts` co-edits (per coordination rule).
- **Subtasks:**
  - [x] test-first: `window.test.ts` — 12 tests covering daily UTC boundary (midnight + 23:59:59.999), weekly ISO week (Mon start, Sun end fixtures), lifetime `[0, Infinity)`, day-boundary edge cases. **All windows UTC** per plan §3 / spec.
  - [x] test-first: `filter.test.ts` — 23 tests covering every FilterClause variant (`eq`, `gte`, `lte`, `gt`, `lt`, `in`), composite multi-key AND semantics, missing payload field → false, wrong-typed value → false, empty filter `{}` / undefined → true.
  - [x] test-first: `evaluator.test.ts` — 25 tests covering all 6 seed missions, status transitions (locked→active→completed), claimed-status terminal semantics (same window = no match; window advanced = fresh attempt), window-reset counter behavior, expiresAt enforcement, mid-window vs prior-window events.
  - [x] test-first: `index.test.ts` — 7 integration tests via pool-workers using real D1 + seeded migrations, asserting `evaluateEvent` returns correct `MissionProgress[]` and persists changes via `db.batch([...])`.
  - [x] implement: pure functions in `window.ts` (UTC math — weekly anchored via +3-day offset to convert epoch Thursday → Monday timeline, mod-7d), `filter.ts` (`matchesClause` + `matchesFilter` with `Object.is || canonicalJson` deep-equal), `evaluator.ts` (single `now = Date.now()` per request for window-consistency; counter resets on window advance; `claimed → locked` reset on new window for non-lifetime).
  - [x] implement: `index.ts` orchestrator — single SELECT for all candidate-mission progresses (`WHERE user_id = ? AND mission_id IN (?2..?N+1)`), per-mission evaluate(), single `db.batch([...])` upsert. Locked contract `evaluateEvent(db, event, candidateMissions): Promise<MissionProgress[]>` met verbatim.
  - [x] verify: `--coverage.include='src/rules/**'` → **window 100%, index 100%, filter 96.07% / 96.29% branch, evaluator 93.93% / 93.33% branch** — comfortably > 90% target. Aggregate 96.8% statements / 95.91% branches. Uncovered lines are unreachable defensive paths (`clamp01` NaN, falsy iterator guards).
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 13:45 — Implementation complete by `rule-engine-builder` (Opus 4.6) running parallel to TASK-008. **Decisions documented inline:** (a) Deep-equal uses `Object.is(a,b) || canonicalJson(a) === canonicalJson(b)` with sorted object keys — handles hosts that reorder JSON keys (e.g. via different serialisers). (b) Numeric comparators (`gte/lte/gt/lt`) require `Number.isFinite` — `NaN` against any threshold returns false, matching the "no implicit coercion" rule extended to "no non-finite numbers". (c) **Claimed-status semantics resolved** (this was the brief's "figure it out yourself"): if `currentProgress.status === "claimed"` AND `updatedAt` is in the **current** window → no match. If `updatedAt` is in a **prior** window → window has advanced, treat as fresh attempt (counter resets, status flows `locked → active → completed` normally; next claim allowed). For `lifetime` missions, claimed stays terminal forever (no prior window ever exists). (d) Default `criteria.window = "lifetime"` when unset. (e) Over-shoot allowed — `currentCount` can exceed `targetCount` (e.g. additional matching events after completion); `progress` clamped to [0,1] but raw counter preserved for analytics. (f) Single `now = Date.now()` per `evaluateEvent` invocation prevents request-at-23:59:59.999 spanning two daily windows mid-loop. (g) D1 `IN (...)` parameter count: SQLite default `SQLITE_MAX_VARIABLE_NUMBER = 999`; realistic candidate sets <50, no concern for v0.1. Flagged for TASK-010/011 if mission catalogue grows. (h) **No `schema.ts` co-edit** — cross-mission progress lookup lives in `rules/index.ts` per coordination rule; if a second consumer arises, future task can promote to a helper. File locks released.

---

### Task: [TASK-010] Missions / balance / campaigns routes

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no
- **Assigned:** routes-builder (sub-agent, Opus 4.6)
- **Depends on:** TASK-008, TASK-009
- **Skills:** `superpowers:test-driven-development`
- **Files:** `workers/api/src/routes/{missions.ts (318 LOC), balance.ts (52 LOC), campaigns.ts (80 LOC)}`, `workers/api/test/{missions.route.test.ts (533 LOC, 18 tests), balance.route.test.ts (176 LOC, 7), campaigns.route.test.ts (183 LOC, 7)}`, modified `workers/api/src/db/schema.ts` (+187 LOC `claimMission` helper with discriminated `ClaimOutcome` union) and `workers/api/src/index.ts` (+18 LOC, mounted 3 routers alphabetically between `/v1/auth` and `/v1/events`).
- **Subtasks:**
  - [x] test-first: 32 new tests across 3 route files. Missions: GET list happy / filtered by `?status=active` (after firing 1× `purchase.completed` returns M1) / filtered by `?campaignId` / pagination via `?limit&cursor` / GET single happy + 404; POST claim on not-completed → 409 / on completed → 200 with status→`claimed` + balance +100 coin / idempotent replay (same mission twice = no double-mint) / Idempotency-Key header replay with `X-Idempotent-Replay: hit` / badge-reward claim (M2 — `balance: null` in response, no row written); 401 on all routes. Balance: empty → 200 `[]` (not 404) / single-currency → 404 when no row / after claim → +100 coin row visible. Campaigns: list returns 2 seed / `?include=expired` doesn't filter (both seeds still active 2026-04..06) / single with `?include=missions` hydrates 3 missions / 404 on unknown.
  - [x] implement: `routes/missions.ts` — three routes (list with status+campaign+cursor, single, atomic claim). Status filter applied JS-side after the DB page fetch (preserves cursor stability against listMissions id-ordering — DB-side would need a JOIN that changes the cursor schema; trade-off documented in JSDoc).
  - [x] implement: `routes/balance.ts` — list + single-currency. Single-currency intentionally returns 404 instead of synthetic 0-balance (truthful: row doesn't exist) with JSDoc instructing SDK clients to treat 404 as "0 for display purposes".
  - [x] implement: `routes/campaigns.ts` — list with `?include=expired` toggle (default filters `endAt >= now`) + single with `?include=missions` hydration via `Promise.all(getMission(...))`.
  - [x] implement: `db/schema.ts` atomic `claimMission(db, userId, missionId, nowMs)` — discriminated `ClaimOutcome = "not_found" | "not_completed" | "claimed_now" | "claimed_idempotent"` (richer than the briefed `null` return; lets the route differentiate "first claim → broadcast SSE" from "replay → skip broadcast"). Uses `db.batch([UPDATE WHERE status='completed' CAS, balance upsert])` for atomicity. CAS-loss retry path (concurrent claim) bounds at 2 iterations.
  - [x] verify: typecheck exit 0; **133 passed / 1 skipped across 10 test files** (was 101 / 1 → +32 / 0); routes/missions 91.35% lines / 85.07% branches, routes/balance & campaigns 100% / 100%, schema.ts delta on `claimMission` 84.82% statements / 73.91% branches (uncovered = CAS-retry path, hard to hit deterministically in workerd); lint exit 0; `wrangler deploy --dry-run` → 99.41 KiB / 24.08 KiB gzip with all 8 bindings.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 14:10 — Implementation complete by `routes-builder` sub-agent (Opus 4.6). **Key decisions / flags:** (a) **SDKUpdate type gap surfaced** — `packages/types/src/sdk-update.ts` has NO `mission.claimed` variant; agent broadcasts BOTH `reward.granted` + `balance.changed` (when currency reward minted balance) per successful claim as a workaround. Flagged for TASK-002 to consider adding a `mission.claimed` variant with `{progress, reward, balance}` in one message; would let this route emit a single broadcast and simplify the SDK consumer. (b) **Two-layer idempotency for claim**: header-driven (KV cache) returns `X-Idempotent-Replay: hit`; state-driven (helper detects `status='claimed'` on SELECT path) returns same response without the header (no client-provided key to echo) and **does NOT re-broadcast** (only `claimed_now` emits SSE; `claimed_idempotent` is silent). (c) **404-vs-409 collapse on claim**: helper returns `not_found` whether mission is missing OR user has no progress row; route runs a second `getMission` lookup to disambiguate → `mission_not_found` (404) vs `claim_not_ready` (409). (d) **`balance: null` in claim response** when `reward.kind !== "currency"` (e.g. badge/item rewards don't write to balances table). (e) **SSE broadcast best-effort** wrapped in try/catch — 501 stub treated as warn+continue (same pattern as events.ts rate-limiter stub); claim succeeds even on broadcast failure (TASK-012's SDK replay-on-reconnect fills the gap). (f) `claimMission` SSE broadcast expects DO contract from TASK-011: `POST https://_/broadcast` with JSON body matching `SDKUpdate`; 200 = success, anything else = warn but claim still completes. File locks released.

---

### Task: [TASK-011] Durable Objects + SSE endpoint

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no
- **Assigned:** do-sse-builder (sub-agent, Opus 4.6)
- **Depends on:** TASK-010
- **Skills:** `cloudflare-naming`, `superpowers:test-driven-development`
- **Files:** `workers/api/src/durable/{rate-limiter.ts (200 LOC), sse-hub.ts (174 LOC)}`, `workers/api/src/routes/sse.ts` (57 LOC), `workers/api/test/{rate-limiter.test.ts (187 LOC, 7), sse-hub.test.ts (178 LOC, 8), sse.route.test.ts (91 LOC, 3)}`; modified `workers/api/src/index.ts` (DO stubs replaced with re-exports from `./durable/*`; sseRouter mounted alphabetically), `workers/api/src/routes/events.ts` (`checkRateLimit` 501-allow branch removed; kept defensive try/catch + warn-on-non-200), `workers/api/src/routes/missions.ts` (`tryBroadcastClaim` same treatment).
- **Subtasks:**
  - [x] test-first: rate-limiter.test.ts — 7 tests covering 100-calls-in-window happy path, 101st-call 429 with positive `retryAfterMs` + `Retry-After` header, window-slide cleanup (50-60ms windows + real `setTimeout` for time travel since `vi.useFakeTimers()` doesn't cross workerd boundary), table GC on each check.
  - [x] implement: `RateLimiter extends DurableObject` — SQLite `hits(ts)` table + `idx_hits_ts` index in constructor; `check(limit, windowMs)` deletes hits below `now-windowMs`, counts remaining, returns `{ok, remaining, retryAfterMs?}`; `fetch(req)` translates `/check` query params + maps `ok:false` → HTTP 429 with `retry-after` header (RFC 7231 seconds-rounded-up).
  - [x] test-first: sse-hub.test.ts — 8 tests: empty-subscribers broadcast → `{delivered: 0}`; single subscribe → reader gets `: connected\n\n` sentinel; broadcast → `event: update\ndata: <body>\n\n` reaches all subscribers; closed-writer GC on next broadcast (no throw); unknown-path 404.
  - [x] implement: `SSEHub extends DurableObject` — `Set<WritableStreamDefaultWriter>` in-memory only (intentional — clients reconnect via SDK backoff in TASK-012; not WS Hibernation per plan A9). `fetch` routes `GET /subscribe` and `POST /broadcast`. Initial `: connected\n\n` SSE comment forces header flush so client `onopen` fires. `writable.closed.catch(() => {}).finally(() => writers.delete(...))` for natural-disconnect cleanup; broadcast wraps each write in try/catch and collects stale writers for sweep.
  - [x] implement: `/v1/sse/updates` route — requireAuth → `env.SSE_HUB.get(idFromName(userId)).fetch("https://_/subscribe")` → proxy DO's `Response` (preserves streaming headers).
  - [x] tighten consumers: `events.ts` `checkRateLimit` — keeps try/catch + warn-on-unexpected-status, removed 501-stub branch + TASK-011 comment; `missions.ts` `tryBroadcastClaim` — same treatment (best-effort with try/catch; warn on non-200).
  - [x] wrangler validated: `migrations[{tag:"v1", new_sqlite_classes:["RateLimiter","SSEHub"]}]` already in place from TASK-003. Bundle 106.67 KiB / 26.92 KiB gzip on `wrangler deploy --dry-run`, all 8 bindings recognised.
  - [x] verify: **153 passed / 1 skipped** (was 133/1 → +20). Coverage: rate-limiter 100% lines / 95% branches; sse-hub 89.28% lines (uncovered = natural-disconnect cleanup timing + forced stale-writer GC, both require timing-sensitive setups deferred); sse.ts 100% lines. Lint exit 0; typecheck exit 0; project-wide coverage 93.73% statements / 89.41% branches / 94.96% lines.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 14:45 — Implementation complete by `do-sse-builder` (Opus 4.6). **Key decisions / flags:** (a) Time-travel in tests uses small `windowMs` (50–60 ms) + real `setTimeout` rather than fake timers (`vi.useFakeTimers()` doesn't cross workerd boundary). (b) DO test isolation via `env.RATE_LIMITER.newUniqueId()` / `env.SSE_HUB.newUniqueId()` per test; events.route 100/min test uses `idFromName(crypto.randomUUID())`. (c) **SSEHub writers NOT persisted across hibernation** (intentional — client SDK in TASK-012 handles reconnect). No server-side heartbeat in v0.1 — clients rely on browser EventSource `retry:` + SDK-level exponential backoff. (d) The 501-stub branches are gone but defensive try/catch + warn-on-unexpected-status remain — claim still succeeds if broadcast genuinely fails (TASK-012's reconnect+replay fills the gap). (e) **Pre-existing flaky test** noted: `test/jwt.test.ts` "rejects when signature is tampered" flips the last base64url char (A↔B); occasionally the flipped char decodes to the same bytes (boundary issue). Not in scope here; flag for TASK-007 follow-up — recommended fix is to flip a middle byte instead. (f) Wrangler 4.92.0 in dry-run vs catalog `^4.90.0` — both work, no action. **Flags for TASK-012 (SDK):** SSE wire-shape is `event: update\ndata: <SDKUpdate-JSON>\n\n`; SDK must `source.addEventListener("update", handler)` not `onmessage`. **Browser `EventSource` cannot send `Authorization` headers** — SDK should use `fetch` + ReadableStream parsing (or polyfill) rather than native EventSource; the server today only accepts `Authorization: Bearer ...`. The `: connected\n\n` first chunk is a comment (EventSource silently consumes it) — used purely to flush headers so `onopen` fires browser-side. File locks released.

---

### Task: [TASK-012] `@questkit/core` SDK

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no
- **Assigned:** sdk-core-builder (sub-agent, Opus 4.6)
- **Depends on:** TASK-011
- **Skills:** `superpowers:test-driven-development`
- **Files:** `packages/core/{package.json (70 LOC), tsdown.config.ts (19), tsconfig.json (12), jest.config.cjs (56), src/{index.ts (27), errors.ts (35), storage.ts (100), event-queue.ts (335), sse.ts (342), polling.ts (182), client.ts (660)}, test/{errors,storage,event-queue,sse,polling,client}.test.ts}` — 11 src files (~1.7k LOC), 6 test files (~1.6k LOC).
- **Subtasks:**
  - [x] test-first: 87 tests across 6 files. `client.test.ts` (36) covers every server-route method (auth/events/missions/balance/campaigns/sse) with mocked fetch, asserting URL + headers + body shape match the locked contracts from TASK-007/010/011. `event-queue.test.ts` (14) covers enqueue + dedup by idempotencyKey, exp-backoff retry on 5xx (`baseBackoffMs * 2^attempts`), give-up after `maxAttempts`, bounded queue size (drop oldest when full), localStorage persistence round-trip. `sse.test.ts` (11) covers mocked fetch + ReadableStream parsing: happy path, multi-message chunks, chunked-mid-message reassembly, comment-only lines (`: connected\n\n`) ignored, malformed JSON → onError but stream continues, network error → reconnect with backoff, giveUp after `maxReconnectAttempts`. `polling.test.ts` (11), `storage.test.ts` (11), `errors.test.ts` (4).
  - [x] implement: `QuestKitClient` (660 LOC) — `mintToken`, `fireEvent` (with auto-idempotency-key generation + 5xx-queues + plaintext-fallback), `getMissions`/`getMission`/`claimMission`, `getBalances`/`getBalance` (404→null), `getCampaigns`/`getCampaign`, `subscribe` (fan-out from single SSE), `destroy`. Internal `request<T>` helper for uniform auth header + JSON parse + error mapping. `resolveUserId()` parses JWT `sub` claim unsigned (we trust our own tokens; no signature verification on client). `fetchImpl` injection in `QuestKitConfig` for testability.
  - [x] implement: `event-queue.ts` — persistent queue via `Storage` interface; `LocalStorageAdapter` (defensive try/catch — private mode throws) or `MemoryStorage` (Map fallback) auto-detected via probe. Exp backoff `baseBackoffMs * 2^attempts`. **`SendResult` shape extended** beyond brief: `{ok: false, status, retryable}` so 4xx → drop immediately, 5xx + 408 + 429 → retry — matches the client's retry policy.
  - [x] implement: `sse.ts` — **`fetch` + ReadableStream** (NOT native `EventSource` — flagged by TASK-011 since browser `EventSource` can't send Authorization headers). Homebrew SSE parser (~50 LOC) handles `\n\n` and `\r\n\r\n` separators, multi-line `data:` concat per spec, mid-chunk reassembly via string buffer, comment lines ignored. JSON.parse → `as SDKUpdate` type-assertion (server is our own code; runtime discriminator skipped — flagged inline as opt-in opportunity).
  - [x] implement: `polling.ts` — 5s interval default (configurable via `pollIntervalMs`), stringified-diff against previous snapshot, emits synthetic `SDKUpdate[]` (best-effort — emits `mission.progress` not `mission.completed`, never `reward.granted`; documented caveats in JSDoc).
  - [x] implement: tsdown ESM+CJS+DTS build (mirrored `packages/types/tsdown.config.ts` pattern). External `[]` (`@questkit/types` is type-only). `treeshake: true`, `minify: false` (consumer bundlers handle that).
  - [x] verify: typecheck exit 0; build emits `dist/index.{js (9.87 KB gzip), cjs (9.88 KB gzip), d.ts, d.cts}` + maps; **87/87 tests pass in 1.85s**; coverage **91.9% lines / 89.26% statements / 78.57% branches** (target was 70% lines ✅); **bundle 9.63 KB gzipped** (target ≤ 15 KB ✅, 36% under budget); lint exit 0; ESM sanity load lists `[QuestKitClient, QuestKitError]`.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 15:20 — Implementation complete by `sdk-core-builder` (Opus 4.6). **Decisions documented:** (a) **ts-jest non-ESM preset chosen** over `ts-jest/presets/default-esm` — ESM preset requires `.js` extension dance in test imports + Node ESM flags; non-ESM path keeps tests clean and runtime cost is zero (tsdown emits both ESM + CJS for consumers). Config overrides `module: CommonJS` + `verbatimModuleSyntax: false` for ts-jest's transpile only. (b) **SSE parser is homebrew** (~50 LOC) — no `eventsource-parser` dep needed, easily stays under 15 KB budget. (c) **`SDKUpdate` runtime validation deliberately skipped** — server is the only producer, type-assertion is safe; runtime discriminator could be added behind opt-in flag if third-party broadcasts ever land. (d) **Polling diff coarseness flagged** — emits `mission.progress` for any progress-row change, `balance.changed` on amount delta, never `reward.granted` (no API surface to derive). Consumer derives completion from `status === "completed"`. (e) **`SendResult.retryable`** added to EventQueue interface beyond brief to distinguish 4xx-drop from 5xx-retry. (f) **`fetchImpl` injection** in `QuestKitConfig` defaults to global `fetch` — added for testability with no runtime cost. (g) **`SDKUpdate.mission.claimed` variant still missing** in `packages/types` (flagged previously in TASK-010 + TASK-011) — SDK works around by listening for `reward.granted` + `balance.changed` after claim. TASK-002 follow-up: adding the variant would simplify both server (one broadcast) and client (one update). File locks released.

---

### Task: [TASK-013] Postman + Newman CI

- **Status:** 🟢 completed (worker redeploy + Phase 2 commit handled outside this task by team lead)
- **Priority:** high
- **Parallel:** no (closes Phase 2)
- **Assigned:** postman-newman-builder (sub-agent, Opus 4.6) + team lead (deploy + commit + push)
- **Depends on:** TASK-012
- **Skills:** `git-commit`, `git-push`, `superpowers:verification-before-completion`
- **Files:** `postman/questkit.postman_collection.json` (782 LOC, 32 KB, 16 requests across 6 folders), `postman/questkit.postman_environment.example.json` (31 LOC), `postman/newman-ci.sh` (30 LOC, executable), `.github/workflows/ci.yml` (+30 LOC new `newman` job), `apps/demo/.gitkeep`, `.gitignore` (+1 line `postman/newman-report.json`).
- **Subtasks:**
  - [x] implement: Postman collection — Auth (mint token), Events (fire / fire-with-idem / replay / invalid), Missions (list / by status / single / 404 / claim with 3-event pre-fire), Balance (list / single 200 / single 404), Campaigns (list / single / single with `?include=missions`), SSE (handshake via tight-timeout `pm.sendRequest` in pre-request — Newman can't stream so we capture headers + status into vars instead of GETting `/v1/sse/updates` directly). Webhook tests deferred to Phase 4 (TASK-021/022); recommendations stubbed via 404-expected since AI lands TASK-017.
  - [x] implement: `.example.json` env file — `base_url`, `app_id`, `app_secret` (literal `<set-via-GH-Actions-secret>`), `user_id` placeholders. Real values flow via Newman `--env-var` from GH Actions secret `QUESTKIT_APP_SECRET`.
  - [x] implement: `newman-ci.sh` — `set -euo pipefail`, `$APP_SECRET` required, defaults for `BASE_URL` / `APP_ID` / `USER_ID` (the latter scoped to `newman_$(date +%s)` so each Newman run uses a fresh user → claim test runs deterministically without prior-run state pollution).
  - [x] augment: `ci.yml` — new `newman` job runs after `verify` succeeds; gated by `if: github.event_name == 'push' && github.ref == 'refs/heads/main'` (PRs from forks can't access secrets); uploads `newman-report.json` as CI artifact.
  - [x] verify: collection parses as valid JSON; shell script bash-syntax-valid; YAML parses; Newman dry-run against `https://invalid.example.com` advances through pre-request scripts cleanly (user_id bootstrap fires as `newman_1779169169581`); real-worker Newman run gap documented (production at `api.questkit.jairukchan.com` is still Phase 1 skeleton — only `/v1/health` mounted — closes via the redeploy team-lead is about to drive). Worker test baseline preserved: vitest 153/1 skipped unchanged.
  - [x] commit + push: Phase 2 close-out commit driven by team lead via the `git-commit` skill (CLAUDE.md rule 7 — no AI signatures). Worker redeploy via `wrangler deploy --config workers/api/wrangler.dev.jsonc` happens BEFORE push so Newman can pass against the live worker on the first push-to-main run.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 15:40 — Implementation complete by `postman-newman-builder` (Opus 4.6). **Decisions:** (a) **user_id bootstrap pattern** — collection-level pre-request sets `user_id = newman_$(unix-ms)` exactly once at run-start (sentinel `user_id_bootstrapped`) so every request in a single run uses the same user → claim flow is deterministic across the Missions/Balance folder reads. (b) **Mission claim test pre-fires 3 `purchase.completed` events** with unique idempotency keys + `category:books` in the pre-request script so M1 ("Triple Treat" 3-purchases-today) completes deterministically; without this M1 would only hit `active` (1/3) and claim would 409. (c) **SSE handshake via `pm.sendRequest` + tight 2000ms timeout** then a `/v1/health` placeholder as the actual request — Newman's HTTP layer can't stream, so we capture status + content-type into collection vars and assert on those instead of opening the real stream. (d) **Idempotent-replay header tolerance** — accepts both `hit` (KV) and `db-hit` (D1 partial-unique-index fallback). (e) **Secret naming convention `QUESTKIT_APP_SECRET`** — register in GH repo settings before Phase 2 merges; must match `wrangler secret put APP_SECRET --name questkit-worker-api` value. (f) **Newman pinned `@latest` via npx** — no node_modules bloat; recommend pinning major.minor only if wire-protocol determinism becomes a concern.

---

## Phase 3 — React Components (Day 3)

### Task: [TASK-014] `@questkit/react` scaffold + theme

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no
- **Assigned:** main agent (Opus 4.7)
- **Depends on:** TASK-013
- **Skills:** `frontend-design:frontend-design`, `web-design-guidelines`
- **Files:** `packages/react/{package.json,tsdown.config.ts,tsconfig.json,jest.config.cjs,scripts/copy-styles.mjs,src/{index.ts,provider.tsx,styles/theme.css},test/setup.ts,README.md}`
- **Subtasks:**
  - [x] implement: `package.json` peerDeps `react@^18.3 || ^19`, devDeps from catalog, sideEffects on `**/*.css`, named export `./styles.css`
  - [x] implement: tsdown config (esm+cjs+dts, `deps.neverBundle: ['react','react-dom','react/jsx-runtime','@questkit/core','@questkit/types']`)
  - [x] implement: Tailwind v4 `theme.css` with `@theme { --color-qk-primary, --color-qk-bg, --color-qk-fg, --color-qk-coin, --color-qk-primary-hover, --color-qk-muted, --radius-qk, --font-qk }` (OKLCH values — **Modern Minimal** palette selected by user: indigo primary, near-white bg, deep-slate fg, warm-amber coin). Includes global `prefers-reduced-motion` guard.
  - [x] implement: jest.config.cjs (mirrors `@questkit/core` ts-jest non-ESM pattern; `testEnvironment: 'jsdom'`, `identity-obj-proxy` for CSS modules, `@testing-library/jest-dom` matchers loaded via `setupFilesAfterEnv`, coverage thresholds 60/60/60/50 per plan)
  - [x] implement: `<QuestKitProvider config>` + `useQuestKit()` hook (scaffolded ahead of TASK-015 since the file is named in TASK-014 — actual 5 widget hooks land in TASK-015)
  - [x] implement: `scripts/copy-styles.mjs` post-build step copies `src/styles/theme.css` → `dist/styles.css` (tsdown doesn't process CSS itself; Tailwind compilation is the consumer's job)
  - [x] verify: `pnpm --filter @questkit/react build` → 8 dist files (ESM+CJS+`.d.ts`+`.d.cts` plus sourcemaps + `styles.css`); `pnpm --filter @questkit/react typecheck` exit 0
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 16:45 — Completed by main agent. User contributed: theme palette decision (chose **Modern Minimal** indigo+amber over Playful Gamified and Friendly Coral). Build clean (CJS 1.76 KB / ESM 1.62 KB), styles.css 1.74 KB. **Decisions flagged:**
    - (a) Used `ReactElement` return type instead of `JSX.Element` for React 18.3 ∥ 19 compatibility — React 19 removed the global `JSX` namespace.
    - (b) Followed `@questkit/core`'s `jest.config.cjs` non-ESM ts-jest pattern (plan said "ts-jest ESM preset" — chose CJS for monorepo consistency; rationale documented in core's config doc-block).
    - (c) Provider already includes destroy() cleanup in `useEffect` return — re-creates client only on `baseUrl` or `appId` change to avoid tearing down SSE on every parent re-render.
    - (d) Re-skinning is supported via CSS custom-property overrides at `:root` (documented in `packages/react/README.md`).

---

### Task: [TASK-015] `QuestKitProvider` + hooks

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** no
- **Assigned:** hooks-teammate
- **Depends on:** TASK-014
- **Skills:** `superpowers:test-driven-development`
- **Files:** `packages/react/src/{provider.tsx,hooks/{types,useMissions,useMission,useBalance,useEvent,useCampaign}.ts,index.ts}`, `packages/react/test/hooks/{useBalance,useEvent,useMissions,useMission,useCampaign,provider}.test.tsx`, `packages/react/test/hooks/test-utils.ts`
- **Subtasks:**
  - [x] test-first: each hook — initial loading state → data; subscribes to SSE for incremental updates; unsubscribes on unmount
  - [x] implement: `<QuestKitProvider config={{baseUrl, appId, getToken}}/>` wraps a `QuestKitClient` instance in context (already done in TASK-014; extended with optional test-only `client` injection prop for hook unit tests)
  - [x] implement: 5 hooks reading from context, subscribing to SDK events
  - [x] verify: RTL renderHook tests pass; types are strict (no `any` in return values)
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 17:00 — Claimed by hooks-teammate. Plan: TDD each hook with renderHook + a fake QuestKitClient injected via an optional `client` prop on `QuestKitProvider` (minimal test-shim).
  - 2026-05-19 17:30 — Done. Strict TDD: wrote each test, watched it fail (module-not-found RED), implemented minimal hook, verified GREEN. Results:
    - 6 test suites / 45 tests all passing
    - Coverage: stmts 92.07%, branches 68.18%, funcs 97.5%, lines 98.05% (jest gate: 60%/50% — well clear)
    - `tsc --noEmit` clean under `exactOptionalPropertyTypes: true` + `noUncheckedIndexedAccess`
    - Zero `any` in production code (grep verified)
    - Decision: added a documented test-only `client?: QuestKitClient` prop on `QuestKitProvider` so hooks can be unit-tested against a `FakeClient` jest.Mock without spinning up real SSE/HTTP. Production callers continue to pass `config`.
    - Lint: hook files are clean; 4 pre-existing TASK-014 lint errors remain in `README.md`, `theme.css`, `tsconfig.json` (out of scope for this task).

---

### Task: [TASK-016] Core components

- **Status:** 🟢 completed
- **Priority:** high
- **Parallel:** yes (with TASK-018)
- **Assigned:** core-components-teammate
- **Depends on:** TASK-015
- **Skills:** `frontend-design:frontend-design`, `web-design-guidelines`
- **Files:** `packages/react/src/components/{MissionList,MissionCard,CoinBalance,CampaignBanner,RewardClaimToast,ProgressBar}/index.tsx`, `packages/react/test/components/{MissionList,MissionCard,CoinBalance,CampaignBanner,RewardClaimToast,ProgressBar}.test.tsx`, `packages/react/src/index.ts` (TASK-016 block)
- **Subtasks:**
  - [x] implement: `<MissionList limit? campaignId? status?>` — composes `MissionCard`, slices first 50 + "Load more" stub (no virtualization dep added; v0.1 deliberate)
  - [x] implement: `<MissionCard mission progress? onClaim?>` — title, description, progress bar, reward badge, claim button (state machine: hidden/enabled/pending/claimed)
  - [x] implement: `<CoinBalance currency animated?>` — rolls via rAF (300 ms ease-out cubic); snaps under prefers-reduced-motion
  - [x] implement: `<CampaignBanner campaignId>` — banner image (graceful gradient fallback when no bannerUrl); title + description; 1 Hz countdown when endAt in future
  - [x] implement: `<RewardClaimToastHost>` + `useRewardClaimToast()` — module-singleton emitter → portal under document.body; auto-dismiss after `durationMs` (default 4 s); respects prefers-reduced-motion
  - [x] implement: `<ProgressBar value max label?>` — role=progressbar + aria-valuenow/min/max; CSS-var bound fill (`--qk-fill` indirection so jsdom round-trips the token)
  - [x] verify: accessibility — all interactive elements keyboard-reachable, native button semantics, aria-labels, focus rings via :focus-visible utilities
  - [x] verify: tests — 64 new tests across 6 files (8 ProgressBar / 7 CoinBalance / 7 CampaignBanner / 10 MissionCard / 7 MissionList / 9 RewardClaimToast); was 45 hook tests, now 109 total (incl. 16 TASK-018)
  - [x] verify: `pnpm --filter @questkit/react test` → 109/109 green
  - [x] verify: `pnpm --filter @questkit/react typecheck` → exit 0
  - [x] verify: `pnpm --filter @questkit/react build` → dist/ produced (CJS 55.27 kB + ESM 52.46 kB + d.ts 8.87 kB + styles.css)
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 16:30 — Components implemented + tested. Coverage: 93% lines / 91% functions across the touched files. Decision flags:
    - (a) Used CSS-custom-property indirection (`--qk-fill`, `--qk-track`, `--qk-coin`) to pass theme tokens through `style`. JSDom rejects `var()` values for parsed colour longhands; the indirection makes the token round-trip-able via `style.getPropertyValue("--qk-fill")` for tests. Real browsers resolve the chain transparently.
    - (b) `MissionList` slices to 50 by default + Load More button (lifts cap by 50). No virtualization dep added — once the SDK exposes cursor pagination, the button calls refetch(cursor).
    - (c) `Campaign` type uses `endAt`, not `endsAt` (the brief used both spellings) — implemented against the type, not the brief copy.
    - (d) `MissionCard.onClaim` is an optional callback the parent owns. `useEvent` only fires a `qk.claim.attempt` analytics ping; the actual claim mutation belongs to the parent.
    - (e) `RewardClaimToast` uses a module-scoped emitter singleton, not a React context. Lets `show()` be called from anywhere (including outside the host's subtree).
    - (f) Did NOT add `clsx`. Template literals + `[a,b,c].filter(Boolean).join(" ")` were enough.
    - (g) `src/index.ts` block ordering preserved as per brief (don't reorder TASK-015's hooks). ESLint flags this as a `perfectionist/sort-exports` violation — pre-existing pattern, deferred to TASK-019's commit cleanup.

---

### Task: [TASK-017] AI recommendations

- **Status:** 🟢 done
- **Priority:** medium
- **Parallel:** no
- **Assigned:** sub-agent (Opus 4.7)
- **Depends on:** TASK-016 (component) + TASK-011 (server route comes from here)
- **Skills:** `superpowers:test-driven-development`
- **Files:** `workers/api/src/services/ai.ts` (203 LOC), `workers/api/src/routes/recommendations.ts` (124 LOC), `workers/api/src/index.ts` (+10 LOC), `workers/api/wrangler.test.jsonc` (+10 LOC — declares `ai` binding for route tests), `workers/api/test/ai.service.test.ts` (260 LOC, 8 tests), `workers/api/test/recommendations.route.test.ts` (215 LOC, 7 tests), `packages/core/src/client.ts` (+50 LOC: `getRecommendations()`, `getUserId()`, `RecommendationsResult` type — flagged: touches previously-finalized file but additive only), `packages/core/src/index.ts` (+1 export), `packages/react/src/hooks/useRecommendations.ts` (165 LOC), `packages/react/src/components/RecommendedMissions/index.tsx` (175 LOC), `packages/react/src/index.ts` (+5 LOC, TASK-017 block placed alphabetically between ProgressBar and RewardClaimToast to satisfy `perfectionist/sort-exports`), `packages/react/test/hooks/test-utils.ts` (+10 LOC, FakeClient additions), `packages/react/test/hooks/useRecommendations.test.tsx` (200 LOC, 8 tests), `packages/react/test/components/RecommendedMissions.test.tsx` (165 LOC, 6 tests).
- **Subtasks:**
  - [x] implement: server `ai.ts` — `recommendMissions(env, userId, recentEvents, activeMissions)` → calls `env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {messages: [...]})` with JSON-only system prompt; parses response into `{missionIds, reason}`; caches in KV 1h per userId (`rec:${userId}`); filters hallucinated mission IDs; throws typed `AiResponseError` on malformed output.
  - [x] implement: `/v1/recommendations` route — auth (`requireAuth`) → load last 50 events + active(/completed) missions from D1 via `recentEventsForUser` + `listProgressForUser` → empty-missions short-circuit (no AI call) → `recommendMissions()` → 200 with `{ missionIds, reason, cached, count }` / 502 `ai_response_malformed` / 503 `ai_unavailable`.
  - [x] implement: `useRecommendations()` hook — module-level `Map<userId, CacheEntry>` 5-min in-memory cache (per-user); SSE `recommendation` invalidation; matches existing `HookState<T>` shape; `__clearRecommendationsCacheForTests` test escape hatch.
  - [x] implement: `<RecommendedMissions>` component — composes `useRecommendations` + `useMission(id)` per slot; renders up to 3 `MissionCard`s with AI reason as italic caption; "Refreshes hourly" hint visible when `cached:true`; loading skeleton + empty state + error state with retry.
  - [x] verify: 15 new worker tests (cache HIT/MISS, system-prompt-verbatim, prompt-injection security canary, malformed AI → throws, hallucinated ID → filtered, all route status codes incl. cache-hit on 2nd call); 14 new react tests (loading, success, error, 5-min cache, per-userId scope, SSE invalidation, refetch, render, empty, error, cached:true hint, cached:false hint absence). All workers + react test suites green. Coverage on `services/ai.ts`: 88.88% lines, 100% functions, 76.66% branches; `routes/recommendations.ts`: 100% lines, 100% functions, 75% branches.
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 21:45 — Implemented TDD-first (each file: failing test → minimal code to pass). Server: 153 → 168 tests (+15). React: 109 → 123 tests (+14). No new lint debt (1 NEW sort-exports violation eliminated by placing TASK-017 block alphabetically between ProgressBar and RewardClaimToast within the existing TASK-016 group). Decisions: (a) wrangler.test.jsonc now DECLARES the `ai` binding so route tests can `vi.spyOn(env.AI, "run")`; remote-proxy never opens because every test mocks `.run` before any call (CI safe — no CF creds needed). (b) Service `recommendMissions` returns hand-rolled env shape (`Pick<Env, "AI"|"CACHE">`) so unit tests bypass `cloudflare:test` entirely. (c) Short-circuit when activeMissions=[] — saves an inference per the brief. (d) `<RecommendedMissions>` slots use one `useMission(id)` per id (cap 3) rather than a bulk fetch — cheap enough at this scale, batch endpoint is a follow-up if cap rises. (e) `getUserId()` added to QuestKitClient as a public wrapper around private `resolveUserId` so the hook can scope its in-memory cache per-user without parsing JWT in the React layer. (f) Flagged: `packages/core/src/client.ts` was previously finalized — the additions (2 public methods + 1 type) are purely additive, no breaking changes. (g) Pre-existing flaky JWT test (`jwt.test.ts` line 64-75) occasionally fails because the base64url last-char-flip can produce the same value when the original last char isn't 'A' or 'B' — unrelated to TASK-017; observed once during the run, deferred.

---

### Task: [TASK-018] Mini-games

- **Status:** 🟢 done
- **Priority:** medium
- **Parallel:** yes (with TASK-016)
- **Assigned:** sub-agent (Opus 4.6)
- **Depends on:** TASK-015
- **Skills:** `frontend-design:frontend-design`, `web-design-guidelines`
- **Files:** `packages/react/src/components/{SpinWheel,ScratchCard}/index.tsx`, `packages/react/test/components/{SpinWheel,ScratchCard}.test.tsx`
- **Subtasks:**
  - [x] implement: `<SpinWheel rewards cooldown onSpin>` — SVG slices via polar coords; CSS `transform: rotate()` with cubic-bezier(0.17,0.67,0.21,1) 4s easing; weighted winner via `crypto.getRandomValues()`; cooldown timer in `localStorage[qk-spin-${id}]`; `prefers-reduced-motion` → instant result; on settle, calls `onSpin(reward)`
  - [x] implement: `<ScratchCard prize onReveal>` — canvas overlay; `pointermove` + `globalCompositeOperation='destination-out'` arcs erase the coating; rAF-throttled `getImageData` sampler tracks erased ratio; `onReveal` fires once when threshold (default 60 %) is crossed; `touch-action: none` for mobile
  - [x] verify: keyboard alternative (Space = spin / progressive reveal); `role="status" aria-live="polite"` region announces result; `prefers-reduced-motion` short-circuits both components
- **Progress Notes:**
  - 2026-05-19 — Task created
  - 2026-05-19 18:30 — Implemented both components (SpinWheel: 360 lines, ScratchCard: 270 lines) + 16 new RTL tests (8 SpinWheel, 8 ScratchCard). Test suite now 61/61 for owned files (was 45 pre-task — TASK-016 teammate added more in parallel). `tsc --noEmit` clean; `tsdown` build green (52.35 kB ESM / 55.16 kB CJS). `src/index.ts` updated with the required `// TASK-018 components` block. Decisions: 8-color default slice palette (OKLCH, matches theme), 5 extra revolutions before settle, BRUSH_RADIUS=20 px, ALPHA_THRESHOLD=64 for erased-pixel classification.

---

### Task: [TASK-019] React tests + commit

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no (closes Phase 3)
- **Assigned:** unassigned
- **Depends on:** TASK-016, TASK-017, TASK-018
- **Skills:** `superpowers:verification-before-completion`, `git-commit`, `git-push`
- **Files:** `packages/react/test/**/*.test.tsx`
- **Subtasks:**
  - [ ] test: each component — renders, prop variants, interaction (click/keyboard), theme variable applied
  - [ ] test: mini-games — SpinWheel ends in cooldown; ScratchCard fires onReveal at threshold
  - [ ] verify: `pnpm --filter @questkit/react test` coverage > 60 %; `tsc --noEmit` clean
  - [ ] commit + push: `feat: react widget library with hooks and mini-games`
- **Progress Notes:**
  - 2026-05-19 — Task created

---

## Phase 4 — Embed + Webhooks (Day 4)

### Task: [TASK-020] `@questkit/embed` IIFE bundle

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes (with TASK-021)
- **Assigned:** unassigned
- **Depends on:** TASK-019
- **Skills:** `frontend-design:frontend-design`
- **Files:** `packages/embed/{package.json,tsdown.config.ts,src/{index.ts,mount.ts,scan.ts,global.ts}}`, `packages/embed/test/*.test.ts`
- **Subtasks:**
  - [ ] implement: tsdown IIFE config (`format:['iife']`, `globalName:'QuestKit'`, `platform:'browser'`, `minify:true`, `deps.alwaysBundle: ['react','react-dom','@questkit/core','@questkit/react','@questkit/types']`)
  - [ ] implement: `scan.ts` — reads `<script data-questkit-app-id=… data-questkit-user-id=… data-questkit-base-url=…>` and finds all `[data-questkit="<widget>"]`
  - [ ] implement: `mount.ts` — for each match, creates a Shadow DOM, attaches stylesheet, ReactDOM.createRoot inside, renders the named component with attribute-derived props
  - [ ] implement: `global.ts` — exposes `window.QuestKit = { fireEvent, claim, getBalance, mount, unmount, on, off }` imperative API
  - [ ] verify: build output single file `dist/questkit.iife.js` ≤ 200 KB gzipped; check via `gzip -c | wc -c`
  - [ ] verify: jsdom test mounts a `<MissionList>` widget into Shadow DOM and reads expected content
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-021] `questkit-worker-webhook-relay`

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes (with TASK-020)
- **Assigned:** unassigned
- **Depends on:** TASK-013
- **Skills:** `cloudflare-naming`, `env-sync`, `superpowers:test-driven-development`
- **Files:** `workers/webhook-relay/{package.json,wrangler.jsonc,src/{index.ts,hmac.ts,normalize.ts}}`, `workers/webhook-relay/test/*.test.ts`
- **Subtasks:**
  - [ ] implement: `wrangler.jsonc` — name `questkit-worker-webhook-relay`, `queues.producers: [{ binding: 'WEBHOOK_QUEUE', queue: 'questkit-queue-webhooks' }]`, secret `WEBHOOK_HMAC_SECRET`
  - [ ] test-first: `hmac.test.ts` — valid sig passes, invalid sig 401, replay (same body + sig within 5 min) blocked
  - [ ] implement: `hmac.ts` — `verify(body: string, header: string, secret: string): boolean` using `crypto.subtle.verify('HMAC')`; timing-safe
  - [ ] implement: `normalize.ts` — `toEvent(rawPayload, source): Event` for each supported provider shape (start with one: a "Stripe-like" example)
  - [ ] implement: `/v1/webhook/incoming` POST handler — verify → normalize → `WEBHOOK_QUEUE.send(event)` → 202 with `{eventId, accepted: true}`
  - [ ] verify: tests green; deploy succeeds
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-022] `questkit-worker-webhook-consumer`

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no
- **Assigned:** unassigned
- **Depends on:** TASK-021
- **Skills:** `cloudflare-naming`, `superpowers:test-driven-development`
- **Files:** `workers/webhook-consumer/{package.json,wrangler.jsonc,src/index.ts}`, `workers/api/src/index.ts` (export `WorkerEntrypoint` class), `workers/webhook-consumer/test/queue.test.ts`
- **Subtasks:**
  - [ ] implement: `workers/api/src/index.ts` — add `export class ApiService extends WorkerEntrypoint<Env> { async ingestEvent(event: Event): Promise<{accepted: boolean, missionsUpdated: string[]}> { ... } }`; the Hono app stays default export
  - [ ] implement: consumer `wrangler.jsonc` — `queues.consumers: [{ queue: 'questkit-queue-webhooks', max_batch_size: 10, max_batch_timeout: 30, max_retries: 5, dead_letter_queue: 'questkit-queue-webhooks-dlq', retry_delay: 30 }]`, `services: [{ binding: 'API', service: 'questkit-worker-api', entrypoint: 'ApiService' }]`
  - [ ] test-first: `queue.test.ts` — success → ack; transient error → retry with exponential delay; permanent error → DLQ after 5 attempts
  - [ ] implement: `queue(batch)` handler — `for (msg of batch.messages) try { env.API.ingestEvent(msg.body); msg.ack() } catch { msg.retry({ delaySeconds: 30 ** msg.attempts }) }`
  - [ ] verify: DLQ messages observable in CF dashboard after deliberately-failing payload test
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-023] `apps/playground` embed testbed

- **Status:** ⚪ pending
- **Priority:** medium
- **Parallel:** no (closes Phase 4)
- **Assigned:** unassigned
- **Depends on:** TASK-020, TASK-022
- **Skills:** `cloudflare-naming`, `frontend-design:frontend-design`, `git-commit`, `git-push`
- **Files:** `apps/playground/{package.json,wrangler.jsonc,public/{index.html,wordpress.html,iframe.html,style.css}}`
- **Subtasks:**
  - [ ] implement: 3 HTML files — (1) plain HTML embedding `<script src="/questkit.iife.js" data-questkit-app-id=… data-questkit-user-id=…>` + `<div data-questkit="MissionList">`; (2) WordPress-styled mock layout; (3) outer page that embeds an `<iframe>` of #1
  - [ ] implement: copy/symlink `packages/embed/dist/questkit.iife.js` into `apps/playground/public` at build time (turbo dependency)
  - [ ] implement: `wrangler.jsonc` for `questkit-worker-play` with `[assets]` binding pointing at `public/`
  - [ ] verify: `wrangler dev` serves the 3 pages, embed works (open in browser, see MissionList render via Shadow DOM)
  - [ ] commit + push: `feat: vanilla JS embed and async webhook pipeline via CF Queues`
- **Progress Notes:**
  - 2026-05-19 — Task created

---

## Phase 5 — Demo + Docs (Day 5)

### Task: [TASK-024] `apps/demo` build (4 scenarios)

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes (with TASK-026)
- **Assigned:** unassigned
- **Depends on:** TASK-023
- **Skills:** `frontend-design:frontend-design`, `web-design-guidelines`, `cloudflare-naming`
- **Files:** `apps/demo/{package.json,wrangler.jsonc,vite.config.ts,index.html,src/{main.tsx,App.tsx,routes/{ecommerce,streaming,daily,minigames}.tsx,panels/{EventLog,DevTools,AIRecommendations}.tsx,styles.css}}`
- **Subtasks:**
  - [ ] implement: Vite 7 + React 18 + Tailwind v4 (`@tailwindcss/vite`) setup; React Router for 4 scenario routes
  - [ ] implement: `wrangler.jsonc` for `questkit-worker-demo` with `[assets] { directory: "./dist", not_found_handling: "single-page-application" }`
  - [ ] implement: e-commerce route — 6 mock products with "Buy" buttons firing `purchase.completed`
  - [ ] implement: streaming route — 6 video tiles with "Watch" firing `video.watched`; badge unlock at 3
  - [ ] implement: daily route — "Check In" button firing `daily.login`; streak counter visible
  - [ ] implement: mini-game route — `<SpinWheel>` + `<ScratchCard>`
  - [ ] implement: `<EventLog>` panel — toggleable bottom drawer; live SSE feed; scrollable, filterable
  - [ ] implement: `<DevTools>` — reset user button (calls a dev-only endpoint OR clears local state), theme switcher (toggles `--qk-primary` light/dark/custom), simulate time (advance daily-streak)
  - [ ] implement: `<AIRecommendations>` — uses `<RecommendedMissions>` from `@questkit/react`
  - [ ] verify: `vite build` succeeds; `wrangler dev` serves locally with hot reload via Vite (or build-once + assets)
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-025] Demo polish + Lighthouse

- **Status:** ⚪ pending
- **Priority:** medium
- **Parallel:** no
- **Assigned:** unassigned
- **Depends on:** TASK-024
- **Skills:** `frontend-design:frontend-design`, `web-design-guidelines`, `frontend-test`
- **Files:** `apps/demo/src/**`, `apps/demo/index.html` (meta tags, OG image)
- **Subtasks:**
  - [ ] implement: framer-motion reward animations (toast slide-in, coin counter pulse, mission-complete checkmark)
  - [ ] implement: dark/light theme via `prefers-color-scheme` + manual toggle in DevTools (CSS vars only — no rerender)
  - [ ] implement: responsive layout (mobile drawer, tablet sidebar, desktop fixed sidebar)
  - [ ] implement: OG meta tags, favicon, theme-color meta
  - [ ] verify: Lighthouse mobile → perf ≥ 90, a11y ≥ 95, best-practices ≥ 95; demo loads < 2 s on Fast 4G throttle
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-026] Docusaurus scaffold

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes (with TASK-024)
- **Assigned:** unassigned
- **Depends on:** TASK-023
- **Skills:** `cloudflare-naming`
- **Files:** `apps/docs/{package.json,wrangler.jsonc,docusaurus.config.ts,sidebars.ts,src/css/custom.css,postcss.config.js,tailwind.config.js?}`
- **Subtasks:**
  - [ ] implement: `pnpm create docusaurus@latest apps/docs classic --typescript`
  - [ ] implement: Tailwind v4 via `@tailwindcss/postcss` in `postcss.config.js` (Docusaurus uses webpack)
  - [ ] implement: import shared `@questkit/react` styles for live MDX examples
  - [ ] implement: `wrangler.jsonc` for `questkit-worker-docs` with `[assets] { directory: "./build" }`
  - [ ] implement: `docusaurus.config.ts` baseUrl `/`, deploymentBranch n/a (we use Worker), navbar (Home, Docs, API, Demo↗, GitHub↗)
  - [ ] verify: `pnpm --filter @questkit/docs build` produces `build/`; `wrangler dev` serves it
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-027] Docs content

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no
- **Assigned:** unassigned
- **Depends on:** TASK-026
- **Skills:** `frontend-design:frontend-design`
- **Files:** `apps/docs/docs/**/*.md(x)` (10 pages)
- **Subtasks:**
  - [ ] write: `intro.md` — Home: hero, what is QuestKit, links to demo + playground
  - [ ] write: `getting-started.md` — 30-second React quick-start + 30-second embed quick-start
  - [ ] write: `concepts/{missions,events,rewards,campaigns,personalization}.md` — one page each, ~200 words + diagram
  - [ ] write: `react/{provider,hooks,components,mini-games,theming}.mdx` — each component documented with props table + live MDX example
  - [ ] write: `embed/{quick-start,data-attributes,api-reference}.md` — HTML snippet, every `data-*` attribute, `window.QuestKit` global API
  - [ ] write: `api/{overview,auth,events,missions,balance,campaigns,sse,webhooks,recommendations}.md` — every endpoint with `curl` + JSON example
  - [ ] write: `webhooks/{overview,hmac,queue-semantics,dlq}.md` — verification example with code, retry/backoff semantics
  - [ ] write: `theming.md` — every CSS variable in a table
  - [ ] write: `self-hosting.md` — link to repo `docs/SELF_HOSTING.md`
  - [ ] write: `faq.md` — incl. "Why React if you're a Vue dev?" — honest 3-paragraph answer about cross-framework cred
  - [ ] verify: `docusaurus build` produces no broken-link warnings
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-028] E2E test sweep

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no (closes Phase 5)
- **Assigned:** unassigned
- **Depends on:** TASK-025, TASK-027
- **Skills:** `frontend-test`, `superpowers:verification-before-completion`, `git-commit`, `git-push`
- **Files:** Playwright test specs (generated by `/frontend-test` skill into `apps/demo/e2e/**` and `apps/playground/e2e/**`)
- **Subtasks:**
  - [ ] run: `/frontend-test` skill — generates Playwright scenarios for each demo route + playground; reviews into plan via additive workflow-plan; user approves; tests run with PDCA loop until zero console errors/warnings
  - [ ] verify: all 4 scenario routes pass; AIRecommendations panel returns ≥ 1 mission; mini-games complete; embed in playground mounts in Shadow DOM
  - [ ] commit + push: `feat: demo app with 4 scenarios and docusaurus documentation`
- **Progress Notes:**
  - 2026-05-19 — Task created

---

## Phase 6 — Polish + Deploy (Day 6)

### Task: [TASK-029] SonarCloud quality gate

- **Status:** ⚪ pending
- **Priority:** medium
- **Parallel:** yes
- **Assigned:** unassigned
- **Depends on:** TASK-028
- **Skills:** -
- **Files:** `sonar-project.properties`, `.github/workflows/ci.yml` (augment), `README.md` (badge slot)
- **Subtasks:**
  - [ ] user-runs: create SonarCloud org + import QuestKit repo
  - [ ] implement: `sonar-project.properties` (org key, project key, source paths, exclusions for `**/dist/**`, `**/*.test.ts`, `apps/docs/build/**`)
  - [ ] augment: ci.yml — add `sonarsource/sonarcloud-github-action@master` step after tests (uses `SONAR_TOKEN` GH secret)
  - [ ] fix: any critical/major issues SonarCloud flags
  - [ ] implement: README badge `![Quality Gate](https://sonarcloud.io/api/project_badges/...)` placeholder (final URL added in TASK-033)
  - [ ] verify: quality gate passes
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-030] Deploy remaining 5 Workers + custom domains

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
- **Depends on:** TASK-022, TASK-023, TASK-025, TASK-027
- **Skills:** `cloudflare-naming`, `deploy`, `superpowers:verification-before-completion`
- **Files:** `.github/workflows/deploy-workers.yml` (already exists from TASK-005, expand matrix to 6)
- **Subtasks:**
  - [ ] deploy: `questkit-worker-demo`, `questkit-worker-docs`, `questkit-worker-play`, `questkit-worker-webhook-relay`, `questkit-worker-webhook-consumer`
  - [ ] user-runs: add custom domains in CF dashboard:
    - `questkit.jairukchan.com` → questkit-worker-demo
    - `docs.questkit.jairukchan.com` → questkit-worker-docs
    - `play.questkit.jairukchan.com` → questkit-worker-play
    - `webhook.questkit.jairukchan.com` → questkit-worker-webhook-relay
    - (`api.` already wired in TASK-005)
  - [ ] verify: all 5 URLs return HTTPS 200; `curl -I` shows valid TLS cert and CF headers
  - [ ] verify: HSTS header present on demo (set in worker response)
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-031] Self-hosting + CF-setup docs

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
- **Depends on:** TASK-005 (commands proven) + TASK-022 (queue commands proven)
- **Skills:** `env-sync`, `frontend-design:frontend-design`
- **Files:** `docs/SELF_HOSTING.md`, `docs/CLOUDFLARE_SETUP.md`
- **Subtasks:**
  - [ ] write: `CLOUDFLARE_SETUP.md` — exact `wrangler d1 create questkit-d1-main`, `wrangler kv namespace create questkit-kv-cache`, `wrangler r2 bucket create questkit-r2-assets`, `wrangler queues create questkit-queue-webhooks`, `wrangler queues create questkit-queue-webhooks-dlq`; then `wrangler secret put` for each secret per worker
  - [ ] write: `SELF_HOSTING.md` — clone → install → run setup script → set 3 secrets → `pnpm deploy:all` → 10-minute target; required CF tier (free); estimated cost ($0 for low-volume)
  - [ ] implement: a `scripts/setup.sh` interactive script that walks a forker through the CF resource creation
  - [ ] verify: copy/paste-able commands actually run; cross-reference against a fresh clone
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-032] 5 ADRs

- **Status:** ⚪ pending
- **Priority:** medium
- **Parallel:** yes
- **Assigned:** unassigned
- **Depends on:** -
- **Skills:** -
- **Files:** `docs/decisions/{001-cloudflare-only-stack,002-react-instead-of-vue,003-sse-over-websockets,004-durable-objects-for-rate-limiting,005-workers-ai-for-personalization}.md`
- **Subtasks:**
  - [ ] write: 001 — context (portfolio + JD), decision (CF-only), consequences (vendor lock, narrative strength, free-tier ceiling), alternatives considered
  - [ ] write: 002 — context (Vue background, JD wants React), decision (React 18+19 peer), consequences (cross-framework cred), alternatives
  - [ ] write: 003 — context (one-way realtime), decision (SSE over WS), consequences (DO doesn't hibernate during streams, but cheap per-user), alternatives
  - [ ] write: 004 — context (per-JWT precision), decision (DO sliding window in SQLite), consequences (cost, eventual consistency), alternatives (KV TTL counter)
  - [ ] write: 005 — context (personalization without storing user vectors), decision (Workers AI Llama 3.1 8B fast — note deprecation of base model, justify -fast variant), consequences (no eval rigor, latency 1-3s), alternatives
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-033] README v1 + demo GIF + social preview

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
- **Depends on:** TASK-029 (badge URL), TASK-030 (live URLs)
- **Skills:** `frontend-design:frontend-design`
- **Files:** `README.md`, `.github/social-preview.png` (Canva), `docs/media/demo.gif` (or `.webm`)
- **Subtasks:**
  - [ ] write: README per spec §8 — center-aligned title, badges (license, CI, SonarCloud, npm-soon, bundle-size, "Powered by Cloudflare"), demo GIF, 4 links (demo/docs/playground/self-hosting), elevator pitch, quick-start (React + embed), features list with ✅, mermaid architecture diagram, "Why I Built This" honest section, tech stack table, self-hosting blurb, local dev, roadmap, license
  - [ ] record: 60-second demo screencap covering one scenario + claim + recommendation
  - [ ] design: 1280×640 social preview in Canva (logo, tagline, "Cloudflare-native", screenshot collage)
  - [ ] verify: README renders correctly on mobile (GitHub mobile app) and desktop
- **Progress Notes:**
  - 2026-05-19 — Task created

---

### Task: [TASK-034] Pre-launch sweep + v0.1.0 tag

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** no (closes the build)
- **Assigned:** unassigned
- **Depends on:** TASK-029, TASK-030, TASK-031, TASK-032, TASK-033
- **Skills:** `superpowers:verification-before-completion`, `git-commit`, `git-push`
- **Files:** `CHANGELOG.md`, repo tag
- **Subtasks:**
  - [ ] verify: `gitleaks detect --no-banner` exits 0
  - [ ] verify: `pnpm audit --prod --audit-level=high` exits 0
  - [ ] verify: all 5 production URLs return HTTPS 200 (curl matrix)
  - [ ] verify: CI green on `main`
  - [ ] verify: README renders, social preview shows up on Twitter Card validator
  - [ ] verify: Lighthouse on demo + docs (≥ 90 / ≥ 95 / ≥ 95)
  - [ ] verify: SonarCloud quality gate = pass
  - [ ] verify: `npm pack --dry-run` for each publishable package (no surprises)
  - [ ] write: `CHANGELOG.md` v0.1.0 entry (feat list, full diff link)
  - [ ] commit + tag: `chore: v0.1.0 — production deploy and launch polish` ; `git tag v0.1.0` ; `gh release create v0.1.0 --notes-from-tag`
  - [ ] post-launch: pin repo on GitHub profile; verify topics complete; (optional) post to /r/cloudflare + LinkedIn
- **Progress Notes:**
  - 2026-05-19 — Task created

---

## File Lock Registry

| File                          | Locked by | Task | Since |
| ----------------------------- | --------- | ---- | ----- |
| _(empty — Phase 2 close-out)_ |           |      |       |

---

## Status Legend

- ⚪ pending — not started
- 🟡 in_progress — assigned + active
- 🟢 completed — implementation + tests done, verification passed
- 🔴 blocked — see Progress Notes for blocker
- ⚫ skipped — moved to roadmap with rationale

## Phase Gates

| Phase | Gate                                                                | Commit message                                                           |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 1     | TASK-005 done, CI green, repo public on GitHub                      | `chore: scaffold monorepo and deploy api worker shell`                   |
| 2     | TASK-013 done, Newman 100 %, Jest coverage ≥ 70 % on core           | `feat: core SDK with rule engine, Durable Objects, and Analytics Engine` |
| 3     | TASK-019 done, RTL coverage ≥ 60 %, no `any` in public API          | `feat: react widget library with hooks and mini-games`                   |
| 4     | TASK-023 done, embed ≤ 200 KB gzipped, DLQ tested                   | `feat: vanilla JS embed and async webhook pipeline via CF Queues`        |
| 5     | TASK-028 done, Lighthouse passes, zero console errors               | `feat: demo app with 4 scenarios and docusaurus documentation`           |
| 6     | TASK-034 done, all checks pass, `v0.1.0` tagged + Release published | `chore: v0.1.0 — production deploy and launch polish`                    |
