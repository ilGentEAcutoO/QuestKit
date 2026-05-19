# Plan: QuestKit v0.1.0 — Gamification SDK Toolkit

> Created: 2026-05-19 (timestamp will be re-applied on each addition)
> Status: **approved** (user selected "All 6 phases, full tasks now" without requesting draft)
> Owner: Bosso (`@ilGentEAcutoO`)
> Source spec: [`../instruction.md`](../instruction.md) — authoritative
> Requirements & overrides: [`./requirements.md`](./requirements.md)
> Tracking: [`./todos.md`](./todos.md)

---

## 0. Table of Contents

1. [Headline](#1-headline)
2. [Architecture](#2-architecture) — topology, naming, bindings, domain map
3. [Spec Amendments](#3-spec-amendments) — every delta from `instruction.md` with rationale
4. [Public-Repo Discipline](#4-public-repo-discipline)
5. [Security Considerations](#5-security-considerations)
6. [Test Specifications (TDD)](#6-test-specifications-tdd)
7. [Phase Plan & Tasks](#7-phase-plan--tasks) — 34 tasks across 6 phases
8. [Critical-Path Sequencing](#8-critical-path-sequencing)
9. [Out-of-Scope (Anti-Goals)](#9-out-of-scope-anti-goals)

---

## 1. Headline

QuestKit is a public, open-source, **Cloudflare-only**, embeddable gamification SDK:
React component library + vanilla `<script>` embed + REST API + SSE + webhooks +
Workers-AI personalization. Six-day build, six phases, one commit per phase.

**Three things make this plan defensible in an interview:**

1. **Pure-Workers stack** — every URL terminates at a Cloudflare Worker (the API,
   the demo, the docs, the playground, the webhook pipeline). No Pages, no Vercel,
   no external runtime. Demonstrates the 2026 CF best practice (Workers Static Assets).
2. **Production-grade hygiene from commit 0** — strict TS, no `any` in public APIs,
   `gitleaks` in CI, SonarCloud quality gate, Conventional Commits, ADRs for every
   non-obvious choice, MIT + CoC + Security policy + 10-minute self-hosting guide.
3. **Real engineering tradeoffs documented** — five ADRs explain _why_ (CF-only,
   React-not-Vue, SSE-not-WebSockets, DOs-for-rate-limiting, Workers-AI-personalization).
   Recruiters skim, senior engineers drill — both are served.

---

## 2. Architecture

### 2.1 Deployment Topology — Workers-only

```
Custom domain: questkit.jairukchan.com (CF DNS, user-owned)

apex/demo           → questkit-worker-demo            [assets binding → Vite build]
api.questkit...     → questkit-worker-api             [REST + SSE + DO + AI + D1 + KV + R2 + AE]
docs.questkit...    → questkit-worker-docs            [assets binding → Docusaurus build]
play.questkit...    → questkit-worker-play            [assets binding → static HTML]
webhook.questkit... → questkit-worker-webhook-relay   [HMAC verify + Queue produce]
(internal/queue)    → questkit-worker-webhook-consumer [Queue consume + RPC to api]
```

Six Workers total. The static-asset Workers (demo/docs/play) are bundles of
HTML/CSS/JS served via the `[assets]` binding — no server logic, but technically
still Workers, so the topology is uniform: `wrangler deploy` everywhere, one CI
workflow, one cost model.

### 2.2 Resource Naming (skill-enforced)

All resources follow `[project]-[service]-[purpose]`:

| Type                     | Name                               | Wrangler binding                                              |
| ------------------------ | ---------------------------------- | ------------------------------------------------------------- |
| Worker                   | `questkit-worker-api`              | n/a                                                           |
| Worker                   | `questkit-worker-webhook-relay`    | n/a                                                           |
| Worker                   | `questkit-worker-webhook-consumer` | n/a                                                           |
| Worker                   | `questkit-worker-demo`             | n/a                                                           |
| Worker                   | `questkit-worker-docs`             | n/a                                                           |
| Worker                   | `questkit-worker-play`             | n/a                                                           |
| D1                       | `questkit-d1-main`                 | `DB`                                                          |
| KV                       | `questkit-kv-cache`                | `CACHE`                                                       |
| R2                       | `questkit-r2-assets`               | `ASSETS_R2` (to avoid clash with the `[assets]` binding name) |
| Queue (main)             | `questkit-queue-webhooks`          | `WEBHOOK_QUEUE`                                               |
| Queue (DLQ)              | `questkit-queue-webhooks-dlq`      | n/a (auto)                                                    |
| DO class                 | `RateLimiter`                      | `RATE_LIMITER`                                                |
| DO class                 | `SSEHub`                           | `SSE_HUB`                                                     |
| Analytics Engine dataset | `questkit_events`                  | `EVENTS_AE`                                                   |
| Workers AI               | (no resource)                      | `AI`                                                          |

### 2.3 Wrangler Config — `wrangler.jsonc` not `wrangler.toml`

Cloudflare's official recommendation since Wrangler 3.91, mandatory for some
newer features. Template (per Worker):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "questkit-worker-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-19",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "questkit-d1-main",
      "database_id": "<set-per-env>",
    },
  ],
  "kv_namespaces": [{ "binding": "CACHE", "id": "<set-per-env>" }],
  "r2_buckets": [
    { "binding": "ASSETS_R2", "bucket_name": "questkit-r2-assets" },
  ],

  "queues": {
    "producers": [
      { "binding": "WEBHOOK_QUEUE", "queue": "questkit-queue-webhooks" },
    ],
  },

  "durable_objects": {
    "bindings": [
      { "name": "RATE_LIMITER", "class_name": "RateLimiter" },
      { "name": "SSE_HUB", "class_name": "SSEHub" },
    ],
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["RateLimiter", "SSEHub"] },
  ],

  "analytics_engine_datasets": [
    { "binding": "EVENTS_AE", "dataset": "questkit_events" },
  ],

  "ai": { "binding": "AI" },
}
```

Secrets (`wrangler secret put`, never committed): `JWT_SECRET`, `WEBHOOK_HMAC_SECRET`, `APP_SECRET`.

### 2.4 Toolchain (pinned)

| Tool              | Version                                     | Notes                                                                 |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------- |
| Node              | 20.x (LTS)                                  | `.nvmrc = 20`. Installed: v25.2.1 (works, but pin lower for forkers). |
| pnpm              | 10.27.0                                     | `packageManager` field in root `package.json`                         |
| Wrangler          | 4.90.0                                      | `wrangler.jsonc` everywhere                                           |
| TypeScript        | ^5.8.3                                      | strict + `verbatimModuleSyntax` + `moduleResolution: bundler`         |
| Turborepo         | ^2.9                                        | `tasks` key (legacy `pipeline` removed)                               |
| Vite              | ^7.0                                        | demo app                                                              |
| Hono              | ^4.6                                        | all Workers                                                           |
| Tailwind          | ^4.1                                        | CSS-first `@theme` directive                                          |
| React             | peer `^18.3 \|\| ^19`                       | dev-dep 18.3.1                                                        |
| Build tool (libs) | tsdown ^0.6                                 | replaces tsup (maintenance)                                           |
| Docusaurus        | ^3.10                                       | `apps/docs`                                                           |
| Jest              | ^29.7 + ts-jest ^29.2 + RTL ^16             | packages                                                              |
| Vitest            | ^3.2 + @cloudflare/vitest-pool-workers ^0.6 | Workers                                                               |
| Lint              | ESLint ^9.39 + `@antfu/eslint-config` ^3.10 | flat config, zero-config                                              |
| Changesets        | ^2.27                                       | versioning, `fixed` group for 4 publishable packages                  |

### 2.5 Bindings used by `questkit-worker-api`

| Binding         | Backed by        | Used for                                                          |
| --------------- | ---------------- | ----------------------------------------------------------------- |
| `DB`            | D1               | source of truth — missions, progress, balances, events, campaigns |
| `CACHE`         | KV               | idempotency (24h), JWT denylist, AI recommendation cache (1h)     |
| `ASSETS_R2`     | R2               | badge icons, campaign banners, exports                            |
| `RATE_LIMITER`  | DO (SQLite)      | per-JWT sliding window — 100/min ingest, 1000/min reads           |
| `SSE_HUB`       | DO               | per-user `ReadableStream` SSE fanout                              |
| `WEBHOOK_QUEUE` | Queue            | producer for webhook-relay → consumer                             |
| `EVENTS_AE`     | Analytics Engine | event metrics + ingest lag                                        |
| `AI`            | Workers AI       | `@cf/meta/llama-3.1-8b-instruct-fast` for recommendations         |

---

## 3. Spec Amendments

Every deviation from `instruction.md`, with the reason (user override `[U]`, research finding `[R]`, or skill enforcement `[S]`). The spec stays authoritative; this list is the patch.

| #   | Spec area                         | Original                                          | Amended                                                                                                                    | Reason                                                                                |
| --- | --------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A1  | §1 Static hosting                 | Cloudflare Pages                                  | **Workers Static Assets** (`[assets]` binding) for demo/docs/play                                                          | `[U]` "ใช้ได้แต่ worker นะั ห้ามใช้ pages"                                            |
| A2  | §7 Topology                       | apex + 3 Pages subdomains                         | apex + 3 Worker subdomains + `webhook.` + `api.`                                                                           | Follows A1                                                                            |
| A3  | §1 wrangler.toml                  | TOML                                              | **`wrangler.jsonc`** (CF-recommended since 3.91, mandatory for some features)                                              | `[R]`                                                                                 |
| A4  | §1 compatibility_date             | `"2025-01-15"`                                    | **`"2026-05-19"`**                                                                                                         | `[R]` CF best-practice = current date at scaffold                                     |
| A5  | §1 DO config                      | Just `[[durable_objects.bindings]]`               | Add `migrations[].new_sqlite_classes: ["RateLimiter", "SSEHub"]` (required since SQLite-DO became default)                 | `[R]`                                                                                 |
| A6  | §1, §6, §7, §8 names              | `questkit-api`, `questkit-assets`, etc.           | `questkit-worker-api`, `questkit-r2-assets`, etc. (`[project]-[service]-[purpose]`)                                        | `[S]` + `[U]`                                                                         |
| A7  | §1 Wrangler binding for R2        | `ASSETS`                                          | **`ASSETS_R2`**                                                                                                            | Avoid clash with the Workers `[assets]` binding name reserved for static hosting (A1) |
| A8  | §4 line 321 AI model              | `@cf/meta/llama-3.1-8b-instruct`                  | **`@cf/meta/llama-3.1-8b-instruct-fast`**                                                                                  | `[R]` Base model deprecates **2026-05-30** (11 days from today)                       |
| A9  | §5 Phase 2 SSEHub                 | "session affinity" wording                        | Implement with `ReadableStream` + `TransformStream` set per writer. **Not** the WebSocket Hibernation API — that's WS-only | `[R]`                                                                                 |
| A10 | §5 Phase 4 webhook-consumer → api | Service binding via fetch                         | **`WorkerEntrypoint` RPC** (typed, zero serialization)                                                                     | `[R]`                                                                                 |
| A11 | §1 Build tool (packages)          | tsup                                              | **tsdown** (tsup is in maintenance; tsdown is the successor by the same author)                                            | `[R]`                                                                                 |
| A12 | §1 Tailwind                       | Tailwind (implied v3)                             | **Tailwind v4** — CSS-first `@theme` directive maps _better_ to spec's CSS-variable strategy                               | `[R]`                                                                                 |
| A13 | §1 Frontend framework             | React 18                                          | React **peer-dep `^18.3 \|\| ^19`** (dev-dep 18.3.1) — JD said "React" not specifically "18"                               | `[R]`                                                                                 |
| A14 | §1 Vite                           | (no version)                                      | **Vite 7** + `@tailwindcss/vite`                                                                                           | `[R]`                                                                                 |
| A15 | §1 ESLint preset                  | "zero-config preset"                              | `@antfu/eslint-config` flat config (TS + React + formatting in one dep)                                                    | `[R]`                                                                                 |
| A16 | §1 TS flags                       | strict                                            | strict + `verbatimModuleSyntax` + `moduleResolution: bundler` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`  | `[R]`                                                                                 |
| A17 | §1 pnpm                           | workspaces                                        | + **catalog** for TS/React/Vite (single source of version truth)                                                           | `[R]`                                                                                 |
| A18 | §1 Domain                         | `questkit.dev` mentioned, fallback `.workers.dev` | **`questkit.jairukchan.com`** with 4 subdomains                                                                            | `[U]`                                                                                 |
| A19 | §2 .github/workflows              | `deploy-workers.yml` + `deploy-pages.yml`         | Single `deploy-workers.yml` (handles all 6 Workers via turbo-filtered matrix)                                              | Follows A1                                                                            |
| A20 | §2 docs/CLOUDFLARE_SETUP.md       | implied resource list                             | Concrete `wrangler` commands using A6 names; `wrangler d1 create questkit-d1-main` etc.                                    | `[S]`                                                                                 |
| A21 | §1 Queues                         | producer + retry                                  | + explicit DLQ `questkit-queue-webhooks-dlq`, `max_retries: 5`, exponential backoff                                        | `[R]`                                                                                 |

---

## 4. Public-Repo Discipline

The user's reminder ("อย่าลืมว่า repo เป็น public นะ") is treated as a cross-cutting non-functional requirement applied to every task. Concrete enforcement:

| Concern                   | Mitigation                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Secrets in git history    | `gitleaks` runs in pre-commit AND in CI; secrets only via `wrangler secret put` and GitHub Actions secrets; `.dev.vars.example` committed with empty values + `# how to generate` comments |
| Real IDs leaking          | `wrangler.jsonc` uses placeholder `"<set-per-env>"` for `database_id` / `id`; real values via `wrangler.dev.jsonc` (gitignored) for local + GH Actions env vars for CI                     |
| Account / CF credentials  | Never asked of Claude (user runs `wrangler login` themselves per spec §10)                                                                                                                 |
| Embarrassing commits      | Conventional Commits, no AI signature (CLAUDE.md global rule §7), no `wip`/`temp` commits — squash locally before push if needed                                                           |
| Unmaintained appearance   | `dependabot.yml` weekly bumps, SonarCloud badge, CI badge, last-commit visible                                                                                                             |
| Fork friction             | `docs/SELF_HOSTING.md` benchmark — every command tested by re-running clone→deploy on a clean account; `.dev.vars.example` lists every required secret with how-to-generate                |
| Untested public claims    | Every README claim ("real-time", "AI-powered", "10-min deploy") must be true and demonstrable; Lighthouse run for the "loads < 2s" claim                                                   |
| Personal info in commits  | Git author = GitHub user `ilGentEAcutoO`; no real-name email in commits if user prefers (`git config user.email` already set, verified at session start)                                   |
| Embarrassing dependencies | `pnpm audit` in CI; supply-chain hygiene via `minimumReleaseAge: 1440` (24h) in `pnpm-workspace.yaml`                                                                                      |

---

## 5. Security Considerations

| Layer                 | Threat                    | Control                                                                                                                                                                                                                     |
| --------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transport             | MITM                      | HTTPS-only (CF default); HSTS header on the demo Worker                                                                                                                                                                     |
| Auth                  | Token forgery             | JWT HS256 signed by Worker via Web Crypto with `JWT_SECRET` ≥ 32 bytes; JTI in KV denylist for revocation; 1h expiry                                                                                                        |
| Auth                  | Token theft via XSS       | Embed SDK in iframe/Shadow DOM; host stores token in `httpOnly` cookie (recommended pattern in docs)                                                                                                                        |
| Replay                | Duplicate event ingestion | `Idempotency-Key` header → KV cache 24h                                                                                                                                                                                     |
| Abuse                 | API spamming              | Durable Object sliding-window rate limit per-JWT; 429 + `Retry-After`                                                                                                                                                       |
| Injection             | SQL injection in D1       | All queries via D1 prepared statements (`db.prepare().bind()`) — no string concat                                                                                                                                           |
| Injection             | NoSQL injection in KV     | Keys built from server-validated values, never raw user input                                                                                                                                                               |
| Injection             | XSS in embed widgets      | Shadow DOM isolation; no raw-HTML injection APIs in `@questkit/react` (no `dangerously*` props); user-supplied strings rendered as text only — if a host ever needs HTML output, use `DOMPurify` (only place we'd allow it) |
| CSRF                  | State-changing GET        | All mutating endpoints are POST; SameSite=Lax on demo cookies                                                                                                                                                               |
| Webhook spoofing      | Forged inbound events     | HMAC-SHA256 verification against `WEBHOOK_HMAC_SECRET` with timing-safe compare                                                                                                                                             |
| CORS                  | Open API to any origin    | `/v1/auth/token` requires `appSecret` body field; other endpoints accept the JWT regardless of Origin (intentional — SDK runs on any host); CORS preflight allowed for `Authorization`                                      |
| Secret rotation       | Compromise mitigation     | Wrangler secrets rotatable without redeploy; KV denylist invalidates old JWTs immediately                                                                                                                                   |
| Dependency CVEs       | Supply chain              | Dependabot weekly; `pnpm audit` in CI; `minimumReleaseAge: 1440`                                                                                                                                                            |
| Public-repo accidents | Secret leak in PR         | `gitleaks` pre-commit + CI; `.gitignore` audit (`.dev.vars`, `wrangler.dev.jsonc`, `.env`)                                                                                                                                  |
| AI prompt injection   | User content reaches LLM  | Recommender uses only **structured** event data (eventName, count); free-text user input is not forwarded to the LLM                                                                                                        |
| Logging               | PII in logs               | No event payload logging at INFO; userId is opaque (host-provided), no email/IP logged                                                                                                                                      |

---

## 6. Test Specifications (TDD)

Every feature ships with tests written **before or alongside** implementation. Coverage gates checked in CI.

### 6.1 Unit tests (Jest in `packages/*`)

| Package           | Targets                                                                                                                                           | Min coverage |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `@questkit/types` | type-only — verified by `tsc --noEmit`                                                                                                            | n/a          |
| `@questkit/core`  | rule engine (`daily`/`weekly`/`lifetime` windows, all `FilterClause` variants), JWT decode, event queue retry, SSE reconnect backoff, idempotency | **70 %**     |
| `@questkit/react` | hook return shape, component prop validation, theme variable application                                                                          | **60 %**     |
| `@questkit/embed` | data-attribute parser, Shadow DOM mount, global API surface                                                                                       | **60 %**     |

### 6.2 Worker tests (Vitest + `@cloudflare/vitest-pool-workers` in `workers/*`)

Run against a real miniflare-backed Worker env with applied D1 migrations.

| Worker                             | Suites                                                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `questkit-worker-api`              | every route happy-path + 401 + 429 + validation error; rule-engine integration; SSE subscribe + broadcast; DO RateLimiter sliding window; Workers AI recommendation (mocked binding for CI determinism) |
| `questkit-worker-webhook-relay`    | HMAC valid → 202 + queue produced; HMAC invalid → 401; replayed sig → 401                                                                                                                               |
| `questkit-worker-webhook-consumer` | success → `msg.ack()`; transient fail → `msg.retry()` with backoff; permanent fail → DLQ after 5 attempts                                                                                               |

### 6.3 Component / UI tests (Jest + RTL)

Each React component has at minimum: render-without-crash, prop-driven render, click/keyboard interaction, theme-variable application. RTL queries by role/text — no testIds in production code.

### 6.4 API contract tests (Postman + Newman)

A Postman collection covering all endpoints in spec §4 + Idempotency-Key replay + Rate-limit 429 path. Run by Newman in CI against the preview deploy of `questkit-worker-api`. **100 % pass required** to mark Phase 2 done.

### 6.5 E2E tests (Playwright via `frontend-test` skill)

For `apps/demo`: each of the 4 scenario routes loads, the primary CTA fires the right event, the SSE feed shows the update, the reward toast appears, theme toggle works, no console errors/warnings. Triggered by `/frontend-test` after Phase 5.

### 6.6 Static analysis

- `tsc --noEmit` per package + per worker (turbo `typecheck` task)
- `eslint .` per package via `@antfu/eslint-config`
- SonarCloud quality gate (`A` rating required for code smells & vulnerabilities)
- `gitleaks detect` in pre-commit + CI
- `pnpm audit --prod` in CI

---

## 7. Phase Plan & Tasks

Each task = one tracked todo. Full per-task detail (priority, depends, skills, subtasks) lives in [`todos.md`](./todos.md). Below is the one-line index.

### Phase 1 — Foundation (Day 1, 5 tasks)

- **TASK-001** Monorepo scaffold (pnpm + Turborepo + tsconfig + eslint + prettier)
- **TASK-002** `@questkit/types` package with all domain types from spec §3
- **TASK-003** `questkit-worker-api` skeleton (Hono + wrangler.jsonc + `/v1/health`)
- **TASK-004** Public-repo hygiene (LICENSE, CoC, Security, Contributing, .gitignore, .nvmrc, .dev.vars.example, gitleaks pre-commit, issue/PR templates, dependabot, CI workflow, social preview placeholder)
- **TASK-005** Deploy `questkit-worker-api` skeleton + wire `api.questkit.jairukchan.com` custom domain

### Phase 2 — Core SDK + API (Day 2, 8 tasks)

- **TASK-006** D1 schema + migrations (users, missions, mission_progress, balances, events, campaigns, webhooks)
- **TASK-007** JWT auth via Web Crypto + `/v1/auth/token` + Hono JWT middleware on protected routes
- **TASK-008** `/v1/events` ingestion + KV idempotency + Analytics Engine write
- **TASK-009** Mission rule engine (`rules.ts`) — `daily`/`weekly`/`lifetime` + all `FilterClause` variants — TDD (70 %+ coverage before integration)
- **TASK-010** Mission/balance/campaign routes (`/v1/missions`, `/v1/missions/:id`, `/v1/missions/:id/claim`, `/v1/balance*`, `/v1/campaigns*`)
- **TASK-011** Durable Objects (`RateLimiter` SQLite sliding window + `SSEHub` ReadableStream broadcast) + `/v1/sse/updates`
- **TASK-012** `@questkit/core` SDK (`QuestKitClient`, event queue with retry, SSE reconnect, polling fallback) + Jest tests + seed data
- **TASK-013** Postman collection + Newman CI job (`/v1/recommendations` stubbed if AI deferred to Phase 3)

### Phase 3 — React Components (Day 3, 6 tasks)

- **TASK-014** `@questkit/react` scaffold (tsdown ESM+CJS, Tailwind v4 CSS-first `@theme`, peerDeps `^18.3||^19`)
- **TASK-015** `QuestKitProvider` + hooks (`useMissions`, `useMission`, `useBalance`, `useEvent`, `useCampaign`)
- **TASK-016** Core components (`MissionList`, `MissionCard`, `CoinBalance`, `CampaignBanner`, `RewardClaimToast` portal, `ProgressBar`)
- **TASK-017** `useRecommendations` hook + `RecommendedMissions` component + wire `/v1/recommendations` (Workers AI `@cf/meta/llama-3.1-8b-instruct-fast`)
- **TASK-018** Mini-games — `SpinWheel` (SVG rotation), `ScratchCard` (canvas)
- **TASK-019** Jest + RTL tests for all components (60 %+ coverage)

### Phase 4 — Embed + Webhooks (Day 4, 4 tasks)

- **TASK-020** `@questkit/embed` IIFE bundle via tsdown, Shadow DOM mount, `data-questkit="<widget>"` auto-scan, `window.QuestKit` global
- **TASK-021** `questkit-worker-webhook-relay` (HMAC-SHA256 verify + normalize + Queue produce + 202)
- **TASK-022** `questkit-worker-webhook-consumer` (Queue consumer + `WorkerEntrypoint` RPC to api + exponential backoff + DLQ)
- **TASK-023** `apps/playground` static HTML embed testbed (plain HTML + WordPress-styled mock + iframe context)

### Phase 5 — Demo + Docs (Day 5, 5 tasks)

- **TASK-024** `apps/demo` (Vite + React + Tailwind v4) — 4 scenario routes (E-commerce / Streaming / Daily Streak / Mini-Game Corner) + `EventLog` + `DevTools` + `AIRecommendations` panel
- **TASK-025** Demo polish (framer-motion reward animations, dark/light theme, responsive, Lighthouse > 90 on perf/a11y/best-practices)
- **TASK-026** `apps/docs` Docusaurus 3 scaffold + Tailwind v4 via `@tailwindcss/postcss`
- **TASK-027** Docs content — Home, Quick Start (30s), Concepts, React Guide (live MDX examples), Embed Guide, API Reference (every endpoint with curl), Webhook Integration, Theming, Self-Hosting link, FAQ (incl. "Why React if you're a Vue dev?")
- **TASK-028** E2E test sweep via `/frontend-test` (Playwright on demo + playground; zero console errors/warnings gate)

### Phase 6 — Polish + Deploy (Day 6, 6 tasks)

- **TASK-029** SonarCloud setup, badge in README, address all critical/major issues
- **TASK-030** Deploy remaining 5 Workers + wire custom-domain subdomains via CF DNS (api / docs / play / webhook / apex demo)
- **TASK-031** `docs/SELF_HOSTING.md` + `docs/CLOUDFLARE_SETUP.md` (verified by running the steps cleanly on a sandbox CF account if available, or by an external dry-read review)
- **TASK-032** 5 ADRs in `docs/decisions/` (CF-only, React-not-Vue, SSE-not-WS, DO-rate-limiting, Workers-AI-personalization)
- **TASK-033** README v1 (per spec §8) + 60s demo GIF/video + social preview image (Canva, 1280×640)
- **TASK-034** Pre-launch sweep — `gitleaks detect` (must be clean), `pnpm audit`, CI green, all public URLs HTTPS, then `git tag v0.1.0` + GitHub Release with changelog

---

## 8. Critical-Path Sequencing

Tasks marked **parallel: yes** in `todos.md` can be run concurrently by sub-agents within their phase. The phase order is strict (later phases depend on earlier deliverables), but within a phase, parallel tasks fan out.

```
Phase 1 critical path:  001 → 002 → 003 → 004 → 005
Phase 2 critical path:  006 → 007 → (008 ∥ 009) → 010 → 011 → 012 → 013
Phase 3 critical path:  014 → 015 → (016 ∥ 018) → 017 → 019
Phase 4 critical path:  (020 ∥ (021 → 022)) → 023
Phase 5 critical path:  (024 → 025) ∥ (026 → 027) → 028
Phase 6 critical path:  029 ∥ 030 ∥ 031 ∥ 032 ∥ 033 → 034
```

Each phase ends with one conventional commit per spec §5; Phase 6 also tags `v0.1.0`.

---

## 9. Out-of-Scope (Anti-Goals)

Verbatim from spec §9 — **do not build in v0.1**:

- ❌ User registration / login flows (host app provides via JWT)
- ❌ Admin dashboard for mission management (use D1 directly)
- ❌ Mobile native SDK (web only)
- ❌ Multi-tenant billing pages
- ❌ Push notifications
- ❌ Real payment processing (mock only)
- ❌ A/B testing engine (roadmap)
- ❌ **Any non-Cloudflare runtime service** (hard rule)

Anything that arises during the build that isn't strictly required goes to `docs/ROADMAP.md` for v0.2.
