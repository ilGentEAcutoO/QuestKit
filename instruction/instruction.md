# QuestKit — Gamification SDK Toolkit

> An embeddable, cross-platform gamification SDK built end-to-end on Cloudflare's developer platform. React + TypeScript on the frontend, Cloudflare Workers + D1 + Durable Objects + Queues + Workers AI on the backend. Public open-source portfolio piece.

---

## 0. Context for Claude Code

You are helping me build **QuestKit** — a public open-source gamification SDK. This is both a real working product and a job application portfolio piece for a Senior Full-Stack role (React + TypeScript, Gamification & Membership domain, Cloudflare-native).

**Audience that will see this repo:**

- Tech recruiters at IT staffing agencies (initial scan: README, demo URL, code quality)
- Senior engineers / tech leads in interview rounds (deep dive into architecture decisions)
- Future me, reusing parts for other projects
- **Potential forkers** — public repo, assume strangers will clone, run, and self-host

**Therefore the bar is:**

- Production-grade code quality (not hackathon-grade)
- README must sell the project in 30 seconds AND let a stranger deploy their own copy in 10 minutes
- Architecture decisions must be defensible in a technical interview
- All public surfaces (demo, docs, repo) must look polished
- **Zero secrets in git history, ever**

**My background (context for tone & decisions):**

- 8+ years full-stack, senior level
- Primary stack: Vue/Nuxt + TypeScript + Cloudflare ecosystem (Workers, R2, D1, Durable Objects, Workers AI, Queues — used in production)
- This project intentionally uses React (not Vue) to demonstrate cross-framework capability
- AI-first developer — using Claude Code for the build itself is part of the workflow

**You should:**

- Make decisions and proceed when reasonable defaults exist. Don't ask me for permission on every step.
- Ask only when a decision is irreversible or affects public API design.
- Commit frequently with conventional commit messages.
- Run tests before claiming a phase is complete.
- **Treat every commit as if it's going to be public — because it is.**

---

## 1. Locked-In Tech Decisions

These are decided. Do not propose alternatives unless you find a blocking issue.

### Cloudflare-only constraint (HARD RULE)

**Every runtime service must be on Cloudflare.** No Vercel, no Netlify, no Supabase, no Neon, no external CDN, no Auth0, no Heroku, no AWS, no external email service. This is a deliberate constraint to demonstrate deep CF ecosystem expertise.

Allowed non-runtime exceptions:

- **GitHub** — code hosting + Actions
- **SonarCloud** — static analysis (build-time only)
- **npm registry** — package publishing (read-only at runtime)
- **Postman/Newman** — API testing (CI-time only)

### Stack

| Layer                 | Choice                                          | Notes                                   |
| --------------------- | ----------------------------------------------- | --------------------------------------- |
| Package manager       | **pnpm** + workspaces                           |                                         |
| Monorepo orchestrator | **Turborepo**                                   |                                         |
| Language              | **TypeScript 5.x** strict mode                  |                                         |
| Frontend framework    | **React 18**                                    | Required by JD                          |
| Build tool (apps)     | **Vite**                                        |                                         |
| Build tool (packages) | **tsup**                                        | ESM + CJS + types in one config         |
| Styling               | **Tailwind CSS** + CSS variables                | Vars enable runtime theming             |
| Backend runtime       | **Cloudflare Workers**                          | with **Hono** framework                 |
| Database              | **Cloudflare D1**                               | SQLite-on-Workers                       |
| Key-value cache       | **Cloudflare KV**                               | idempotency, JWT denylist, AI cache     |
| Object storage        | **Cloudflare R2**                               | badge icons, campaign banners           |
| Realtime state        | **Cloudflare Durable Objects**                  | rate limiting, SSE session affinity     |
| Async fan-out         | **Cloudflare Queues**                           | webhook delivery retries                |
| Event metrics         | **Cloudflare Analytics Engine**                 | real-time event aggregation             |
| Personalization       | **Cloudflare Workers AI**                       | mission recommendation (Llama 3.1 8B)   |
| Vector search         | **Cloudflare Vectorize**                        | stretch goal — user behavior similarity |
| Image transforms      | **Cloudflare Images**                           | optional, for avatars/badges            |
| Static hosting        | **Cloudflare Pages**                            | demo, docs, playground                  |
| DNS                   | **Cloudflare DNS**                              | if using custom domain                  |
| Realtime delivery     | **Server-Sent Events** via Worker + DO          | polling fallback in SDK                 |
| Auth                  | **JWT (HS256)** signed in Worker via Web Crypto | stateless                               |
| Test framework        | **Jest** + ts-jest + Testing Library            | Required by JD                          |
| Worker testing        | **@cloudflare/vitest-pool-workers**             | actual Worker env, not mocked           |
| API testing           | **Postman** + **Newman** CLI in CI              | Required by JD                          |
| Code quality          | **SonarCloud**                                  | Required by JD                          |
| Documentation         | **Docusaurus 3**                                | Required by JD                          |
| CI/CD                 | **GitHub Actions**                              |                                         |
| Git workflow          | **Conventional Commits** + main + PR-optional   | Solo dev                                |

### CF Bindings (declared in each `wrangler.toml`)

```toml
# workers/api/wrangler.toml
name = "questkit-api"
main = "src/index.ts"
compatibility_date = "2025-01-15"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "questkit"
# database_id provided via wrangler.dev.toml (gitignored) or CI env

[[kv_namespaces]]
binding = "CACHE"
# id provided via env

[[r2_buckets]]
binding = "ASSETS"
bucket_name = "questkit-assets"

[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"

[[durable_objects.bindings]]
name = "SSE_HUB"
class_name = "SSEHub"

[[queues.producers]]
binding = "WEBHOOK_QUEUE"
queue = "questkit-webhooks"

[[analytics_engine_datasets]]
binding = "EVENTS_AE"
dataset = "questkit_events"

[ai]
binding = "AI"

# Secrets (via `wrangler secret put`, never in file):
#   JWT_SECRET, WEBHOOK_HMAC_SECRET
```

---

## 2. Repository Structure

```
questkit/
├── apps/
│   ├── demo/                      # Vite + React showcase (4 scenarios + mini-games)
│   ├── docs/                      # Docusaurus 3 documentation site
│   └── playground/                # Vanilla HTML embed test page
│
├── packages/
│   ├── types/                     # @questkit/types — shared TS types
│   ├── core/                      # @questkit/core — vanilla TS SDK client
│   ├── react/                     # @questkit/react — React components + hooks
│   └── embed/                     # @questkit/embed — IIFE bundle for <script> tag
│
├── workers/
│   ├── api/                       # Main REST API + SSE
│   ├── webhook-relay/             # HMAC verify + Queue producer
│   └── webhook-consumer/          # Queue consumer for delivery retries
│
├── postman/
│   ├── questkit.postman_collection.json
│   ├── questkit.postman_environment.example.json
│   └── newman-ci.sh
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # lint + test + sonar
│   │   ├── deploy-workers.yml     # deploy CF Workers on main
│   │   └── deploy-pages.yml       # deploy demo + docs on main
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
│
├── docs/                          # repo-level docs (not Docusaurus)
│   ├── decisions/                 # ADRs
│   ├── SELF_HOSTING.md            # 10-minute deploy guide for forkers
│   └── CLOUDFLARE_SETUP.md        # wrangler commands to provision resources
│
├── .changeset/                    # version management
├── turbo.json
├── pnpm-workspace.yaml
├── package.json                   # root, devDeps only
├── tsconfig.base.json
├── sonar-project.properties
├── .nvmrc                         # pin Node 20
├── .gitignore                     # see Section 11
├── .dev.vars.example              # template for local secrets
├── LICENSE                        # MIT
├── README.md                      # see Section 8
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
├── CHANGELOG.md
└── CLAUDE.md                      # this file
```

---

## 3. Domain Model

Define all types in `@questkit/types` first. Everything imports from here.

```typescript
// Event — what host apps fire when something happens
export interface Event {
  userId: string;
  name: string; // e.g. "purchase.completed"
  payload: Record<string, unknown>;
  timestamp: number; // unix ms
  idempotencyKey?: string;
}

// Mission — a goal the user can complete
export interface Mission {
  id: string;
  title: string;
  description: string;
  criteria: MissionCriteria;
  reward: Reward;
  campaignId?: string;
  expiresAt?: number;
  iconUrl?: string; // R2-served
}

export interface MissionCriteria {
  eventName: string;
  count: number;
  window?: "daily" | "weekly" | "lifetime";
  filter?: Record<string, FilterClause>;
}

export type FilterClause =
  | { eq: unknown }
  | { gte: number }
  | { lte: number }
  | { gt: number }
  | { lt: number }
  | { in: unknown[] };

export type Reward =
  | { kind: "currency"; currency: CurrencyCode; amount: number }
  | { kind: "badge"; badgeId: string }
  | { kind: "item"; itemId: string; quantity: number };

export type CurrencyCode = "coin" | "point" | "gem" | string;

export interface MissionProgress {
  userId: string;
  missionId: string;
  status: "locked" | "active" | "completed" | "claimed";
  progress: number; // 0..1
  currentCount: number;
  targetCount: number;
  updatedAt: number;
}

export interface Balance {
  userId: string;
  currency: CurrencyCode;
  amount: number;
  updatedAt: number;
}

export interface Campaign {
  id: string;
  title: string;
  description: string;
  startAt: number;
  endAt: number;
  missionIds: string[];
  theme?: CampaignTheme;
  bannerUrl?: string; // R2-served
}

export interface CampaignTheme {
  primaryColor?: string;
}

// SDK realtime update (from SSE)
export type SDKUpdate =
  | { type: "mission.progress"; data: MissionProgress }
  | { type: "mission.completed"; data: MissionProgress }
  | { type: "balance.changed"; data: Balance }
  | {
      type: "reward.granted";
      data: { userId: string; reward: Reward; missionId: string };
    }
  | {
      type: "recommendation";
      data: { userId: string; missionIds: string[]; reason: string };
    };
```

---

## 4. API Spec

All endpoints require `Authorization: Bearer <JWT>` except `/v1/auth/token` and `/v1/webhook/incoming` (HMAC).

```
POST   /v1/auth/token              Body: { appId, appSecret, userId }
                                   → { token, expiresAt }

POST   /v1/events                  Body: Event
                                   → { accepted, missionsUpdated: string[] }
                                   Header: Idempotency-Key (optional)

GET    /v1/missions                Query: ?campaignId, ?status, ?limit, ?cursor
                                   → { missions, progress, cursor? }

GET    /v1/missions/:id            → { mission, progress }
POST   /v1/missions/:id/claim      → { success, reward, newBalance }

GET    /v1/balance                 → { balances: Balance[] }
GET    /v1/balance/:currency       → { balance: Balance }

GET    /v1/campaigns               → { campaigns: Campaign[] }
GET    /v1/campaigns/:id           → { campaign, missions, progress }

GET    /v1/sse/updates             Server-Sent Events stream (DO-backed)

POST   /v1/webhook/incoming        HMAC-SHA256 in X-QuestKit-Signature
                                   Body: arbitrary → normalized to Event
                                   Producer to Queue, async processing
                                   → { eventId, accepted: true }

GET    /v1/recommendations         Workers AI mission suggestions
                                   → { missionIds, reason }
```

**Rate limiting:** Durable Object `RateLimiter` per-JWT — 100 req/min ingestion, 1000 req/min reads. Returns 429 with `Retry-After`.

**Idempotency:** events with same `idempotencyKey` cached in KV 24h.

**Personalization (`/v1/recommendations`):** calls Workers AI with user's recent events (last 50) and active missions; returns top 3 mission IDs with reason. Use `@cf/meta/llama-3.1-8b-instruct`. Cache results in KV 1h per user.

---

## 5. Phase-by-Phase Build Plan

Each phase ends with a git commit and (where applicable) a deployment. **Do not skip ahead.** Run `pnpm test` and `pnpm build` before marking a phase done.

### Phase 1 — Foundation (Day 1)

**Goal:** Empty but valid monorepo, deployable Worker shell, public GitHub repo live.

Tasks:

1. Init pnpm + Turborepo workspace
2. Create all folders per Section 2 with empty `package.json` files
3. Configure `tsconfig.base.json` (strict mode, paths)
4. Configure `turbo.json` pipeline (build, test, lint, dev)
5. Create `@questkit/types` package — paste types from Section 3
6. Create `workers/api` skeleton with Hono + `wrangler.toml` (per Section 1)
   - Single route: `GET /v1/health` → `{ ok: true, version: "0.1.0" }`
7. Create D1 migrations file at `workers/api/migrations/0001_init.sql` (don't apply yet)
8. Create `.github/workflows/ci.yml` — `pnpm install` + `pnpm lint` + `pnpm test`
9. Add `LICENSE` (MIT), `.gitignore` (per Section 11), `.nvmrc` (20), `.dev.vars.example`
10. Add stub `README.md` (full in Phase 6), `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`
11. Push to GitHub as **public** repo named `questkit`
12. Set repo topics: `cloudflare`, `cloudflare-workers`, `gamification`, `react`, `typescript`, `sdk`, `monorepo`, `turborepo`
13. Deploy api worker to `questkit-api.<workers-subdomain>.workers.dev`

Acceptance:

- [ ] `pnpm install` works from clean clone
- [ ] `pnpm build` succeeds
- [ ] `pnpm test` runs (even with zero tests)
- [ ] Worker health endpoint returns 200 in production
- [ ] CI green
- [ ] Repo is public, has topics + description
- [ ] No `.env`, `.dev.vars`, or `wrangler.dev.toml` in git history

Commit: `chore: scaffold monorepo and deploy api worker shell`

---

### Phase 2 — Core SDK + API (Day 2)

**Goal:** Functional `@questkit/core` SDK that talks to a real CF Worker-backed API.

Tasks:

1. Apply D1 migrations: `users`, `missions`, `mission_progress`, `balances`, `events`, `campaigns`, `webhooks`
2. Implement Hono routes in `workers/api`:
   - `/v1/auth/token` — JWT signed via Web Crypto + `JWT_SECRET` env
   - `/v1/events` — idempotency via KV `CACHE`
   - `/v1/missions`, `/v1/missions/:id`, `/v1/missions/:id/claim`
   - `/v1/balance`, `/v1/balance/:currency`
   - `/v1/campaigns`, `/v1/campaigns/:id`
3. Implement rule engine (`workers/api/src/rules.ts`)
4. Implement Durable Objects:
   - `RateLimiter` — per-JWT sliding window counter
   - `SSEHub` — per-user SSE session with broadcast
5. Wire Analytics Engine for every event ingestion
6. Seed data via `wrangler d1 execute --file=seed.sql`: 6 sample missions, 2 campaigns
7. Build `@questkit/core`:
   - `QuestKitClient`: `getToken`, `fireEvent`, `getMissions`, `claimMission`, `getBalance`, `subscribe`, `unsubscribe`
   - Event queue with retry + idempotency
   - SSE reconnect with exponential backoff
   - Polling fallback
8. Jest tests for core (70%+ coverage on rule engine + JWT)
9. Worker tests via `@cloudflare/vitest-pool-workers`
10. Postman collection covering every endpoint
11. Newman in CI against preview Worker

Acceptance:

- [ ] All endpoints return shape per Section 4
- [ ] Rule engine passes unit tests for daily/weekly/lifetime
- [ ] SDK fires event → progress updates → SSE pushes → SDK state reflects it
- [ ] Newman 100% pass in CI
- [ ] Jest coverage 70%+ on core
- [ ] Analytics Engine receives data points (visible in CF dashboard)

Commit: `feat: core SDK with rule engine, Durable Objects, and Analytics Engine`

---

### Phase 3 — React Components (Day 3)

**Goal:** `@questkit/react` package with production-quality widgets.

Tasks:

1. Setup `@questkit/react` with React 18 + Tailwind + tsup build
2. Create `QuestKitProvider` context
3. Hooks: `useMissions`, `useMission(id)`, `useBalance(currency)`, `useEvent`, `useCampaign(id)`, `useRecommendations`
4. Components (each with `.tsx` + `.test.tsx`):
   - `<MissionList limit? campaignId?>`
   - `<MissionCard mission progress>`
   - `<CoinBalance currency animated?>`
   - `<CampaignBanner campaignId>`
   - `<RewardClaimToast>` (portal)
   - `<ProgressBar value max>`
   - `<RecommendedMissions>` (uses Workers AI hook)
5. Theme via CSS variables: `--qk-primary`, `--qk-bg`, `--qk-fg`, `--qk-coin-color`, `--qk-radius`, `--qk-font`
6. Mini-game components:
   - `<SpinWheel rewards cooldown onSpin>` — SVG rotation
   - `<ScratchCard prize onReveal>` — canvas scratch
7. Jest + Testing Library tests (60%+ coverage)

Acceptance:

- [ ] Light + dark theme work via CSS vars
- [ ] Hooks subscribe to SSE and re-render
- [ ] Mini-games fire events to Worker on completion
- [ ] No `any` in public API
- [ ] Tree-shakeable

Commit: `feat: react widget library with hooks and mini-games`

---

### Phase 4 — Embed Mode + Webhook Pipeline (Day 4)

**Goal:** Vanilla `<script>` embed + async webhook fan-out via CF Queues.

Tasks:

1. Build `@questkit/embed`:
   - IIFE output, self-contained (bundles React)
   - Reads `data-*` attributes from `<script>` tag
   - Auto-scans DOM for `data-questkit="<widget>"`
   - Mounts widgets in Shadow DOM
   - Global `window.QuestKit` imperative API
2. Build `workers/webhook-relay`:
   - Verify HMAC signature
   - Normalize payload to internal Event
   - Produce to `WEBHOOK_QUEUE`
   - Return 202 immediately
3. Build `workers/webhook-consumer`:
   - Queue consumer
   - Calls main API via **Service Binding** (not HTTP)
   - Exponential backoff retries
   - DLQ after 5 attempts
4. Build `apps/playground` (pure HTML)
5. Test embed in 3 contexts: plain HTML, WordPress-styled mock, iframe

Acceptance:

- [ ] Embed bundle < 200KB gzipped (soft target)
- [ ] Shadow DOM isolation verified
- [ ] CSS variables inherit from host (opt-in theming)
- [ ] Webhook flow: HMAC verify → Queue → consume → event ingested
- [ ] Queue DLQ tested with intentionally failing payload

Commit: `feat: vanilla JS embed and async webhook pipeline via CF Queues`

---

### Phase 5 — Demo App + Docs (Day 5)

**Goal:** Polished `apps/demo` + Docusaurus docs site.

Tasks:

1. Build `apps/demo` with 4 scenario routes:
   - **E-commerce Loyalty** — mock products, "Buy" fires `purchase.completed`
   - **Content Streaming** — mock video tiles, "Watch" fires `video.watched`, badge at 3
   - **Daily Streak** — "Check In" fires `daily.login`, streak counter
   - **Mini-Game Corner** — spin wheel + scratch card
2. `<EventLog>` panel (live SSE feed, toggleable)
3. `<DevTools>` panel: reset user, switch theme, simulate time
4. `<AIRecommendations>` showcase using `/v1/recommendations`
5. Framer-motion polish on rewards
6. Build Docusaurus site (`apps/docs`):
   - **Home** — hero with live demo iframe, install snippet
   - **Getting Started** — 30-second quick start
   - **Concepts** — Missions, Events, Rewards, Campaigns, Personalization
   - **React Guide** — every component with props table + live example
   - **Embed Guide** — HTML snippet, data attributes reference
   - **API Reference** — every endpoint with curl
   - **Webhook Integration** — HMAC signature, queue retry semantics
   - **Theming** — CSS variables
   - **Self-Hosting** — links to `docs/SELF_HOSTING.md`
   - **FAQ** — including "Why React if you're a Vue dev?" — answer honestly

Acceptance:

- [ ] Demo loads < 2s on 4G (Lighthouse)
- [ ] Docs sidebar navigation complete
- [ ] Every component documented with live example
- [ ] No 404s, no broken links

Commit: `feat: demo app with 4 scenarios and docusaurus documentation`

---

### Phase 6 — Polish + Deploy + Sell (Day 6)

**Goal:** Production deploys + README that closes the deal + fork-ready repo.

Tasks:

1. SonarCloud setup, badge in README, address critical issues
2. Deploy everything to Cloudflare:
   - `questkit-api`, `questkit-webhook-relay`, `questkit-webhook-consumer` → Workers
   - `questkit-demo`, `questkit-docs`, `questkit-play` → Pages
3. GitHub repo polish:
   - About + topics complete
   - Social preview image (Canva, 1280x640)
   - Pin on profile
4. Write README per Section 8
5. Write `docs/SELF_HOSTING.md` — full step-by-step for a stranger:
   - Required CF account tier (free works)
   - Resources to create (D1, KV, R2, Queues, DO)
   - `wrangler.toml` template completion
   - Secrets to set
   - Estimated CF cost (free tier — typically $0)
6. Write `docs/CLOUDFLARE_SETUP.md` — wrangler commands to provision:
   ```bash
   wrangler d1 create questkit
   wrangler kv namespace create CACHE
   wrangler r2 bucket create questkit-assets
   wrangler queues create questkit-webhooks
   # ...
   ```
7. Write 5 ADRs in `docs/decisions/`:
   - `001-cloudflare-only-stack.md`
   - `002-react-instead-of-vue.md`
   - `003-sse-over-websockets.md`
   - `004-durable-objects-for-rate-limiting.md`
   - `005-workers-ai-for-personalization.md`
8. Record 60-second demo GIF/video
9. Add `dependabot.yml`, issue templates, PR template
10. Run `gitleaks detect` — verify no secrets in history
11. Tag `v0.1.0` release with changelog

Acceptance:

- [ ] All public URLs live and HTTPS
- [ ] README renders well on mobile + desktop
- [ ] SonarCloud quality gate: passed
- [ ] CI/CD: green
- [ ] gitleaks clean
- [ ] `docs/SELF_HOSTING.md` enables 10-min deploy for a stranger
- [ ] 5 ADRs published

Commit: `chore: v0.1.0 — production deploy and launch polish`
Tag: `v0.1.0`

---

## 6. Conventions & Standards

### Code style

- Strict TypeScript. No `any` in public APIs.
- ESLint + Prettier (zero-config preset).
- Functional React (hooks only).
- Named exports in libraries.

### Commit messages

Conventional commits with optional scope: `feat(react): add CoinBalance animation`.

### Testing

- Unit tests next to source: `foo.ts` + `foo.test.ts`.
- Worker tests via `@cloudflare/vitest-pool-workers` (real Worker env).
- Newman API tests in CI against preview deployment.

### Wrangler / Workers

- One `wrangler.toml` per worker.
- Bind everything per Section 1 spec.
- Use **Service Bindings** between Workers, never inter-Worker HTTP.
- Multi-environment via `[env.production]`, `[env.staging]`.

---

## 7. Deployment Topology

```
Production (Cloudflare-only)
├── api.<domain>              → workers/api              (REST + SSE + DO + AI)
├── webhook.<domain>          → workers/webhook-relay    (HMAC + Queue producer)
│   └── async ↘ Queues ↘ workers/webhook-consumer       (Queue consumer)
├── <domain>                  → apps/demo                (Pages)
├── docs.<domain>             → apps/docs                (Pages, Docusaurus)
└── play.<domain>             → apps/playground          (Pages, static HTML)

Infrastructure bindings:
├── D1:               questkit                (database)
├── KV:               CACHE                   (idempotency, JWT denylist, AI cache)
├── R2:               questkit-assets         (badge icons, campaign banners)
├── Queues:           questkit-webhooks       (async webhook delivery)
├── Durable Objects:  RateLimiter, SSEHub
├── Analytics Engine: questkit_events
└── Workers AI:       Llama 3.1 8B            (/v1/recommendations)
```

If `questkit.dev` is not owned, fall back to `.workers.dev` and `.pages.dev` subdomains. Document in README.

---

## 8. README Structure (write in Phase 6)

The README is the sales pitch. Recruiters scan it in 20 seconds.

```markdown
<h1 align="center">QuestKit</h1>
<p align="center">
  <em>An embeddable gamification SDK, fully built on Cloudflare's developer platform.</em><br/>
  Missions, rewards, campaigns, and AI-powered recommendations in a single drop-in script.
</p>

<p align="center">
  [badges: license MIT, CI status, SonarCloud quality gate, npm version, bundle size,
   "Powered by Cloudflare"]
</p>

<p align="center">
  [animated 60s demo GIF]
</p>

<p align="center">
  <a href="https://demo.questkit.dev">Live Demo</a> ·
  <a href="https://docs.questkit.dev">Documentation</a> ·
  <a href="https://play.questkit.dev">Embed Playground</a> ·
  <a href="docs/SELF_HOSTING.md">Self-Hosting Guide</a>
</p>

## What is QuestKit?

[3-paragraph elevator pitch]

## Quick Start (30 seconds)

[React snippet — useMissions in 8 lines]
[Vanilla embed snippet — <script> tag]

## Features

- ✅ React component library, full TypeScript support
- ✅ Vanilla JS embed for non-React hosts (Shadow DOM isolated)
- ✅ Event-driven mission rule engine
- ✅ Real-time updates via Server-Sent Events (Durable Object backed)
- ✅ Webhook ingestion with HMAC verification + async Queue retry
- ✅ AI-powered mission recommendations (Workers AI / Llama 3)
- ✅ Cloudflare-native: zero external dependencies at runtime
- ✅ JWT auth with idempotent event ingestion
- ✅ Themeable via CSS variables
- ✅ Mini-game widgets (spin wheel, scratch card)

## Architecture

[Mermaid diagram — SDK ↔ Worker ↔ D1/KV/R2/DO/Queues/AI/AE]

## Why I Built This

[Honest section: portfolio project. Built in 6 days using Claude Code. ADRs in `docs/decisions/`.]

## Tech Stack

[Section 1 table abbreviated]

## Self-Hosting

QuestKit is 100% open source and runs on Cloudflare's free tier for low-volume usage.
See [SELF_HOSTING.md](docs/SELF_HOSTING.md) for a 10-minute deploy guide.

## Local Development

[pnpm install, wrangler login, wrangler dev, pnpm dev]

## Roadmap

[v0.2 — leaderboards, A/B test integration, Vectorize user similarity]

## License

MIT
```

---

## 9. Anti-Goals (Do Not Build)

- ❌ User registration / login flows (host app provides via JWT)
- ❌ Admin dashboard for mission management (use D1 directly for v0.1)
- ❌ Mobile native SDK (web only)
- ❌ Multi-tenant billing pages
- ❌ Push notifications
- ❌ Real payment processing (mock only)
- ❌ A/B testing engine (roadmap, do NOT implement)
- ❌ **Any non-Cloudflare runtime service** (HARD RULE — see Section 1)

If scope creep comes up, push to v0.2 roadmap.

---

## 10. When To Stop And Ask

Proceed without asking:

- Implementation details, file names, internal signatures
- Reasonable styling/UX choices
- Bug fixes, perf optimizations
- Helpful comments / docs

Stop and ask:

- Changing Section 1 locked-in tech (especially Cloudflare-only rule)
- Public API shape changes after Phase 3
- Anything requiring my CF account credentials (I will run `wrangler login` myself)
- Skipping or reordering phases
- Adding a new top-level package or worker
- Stuck > 30 minutes on the same error

---

## 11. Public Repo Hygiene

This is a public repo. Treat every file accordingly.

### `.gitignore` essentials

```
node_modules/
dist/
.turbo/
.wrangler/
.dev.vars
.dev.vars.*
wrangler.dev.toml
wrangler.*.toml
!wrangler.toml
.env
.env.*
*.log
.DS_Store
coverage/
.cache/
.parcel-cache/
.idea/
.vscode/*
!.vscode/settings.json.example
*.tsbuildinfo
```

### Secrets handling

- **Never** commit secret values.
- **Always** commit `.dev.vars.example` and `wrangler.toml` (with placeholder IDs) as templates.
- Real secrets: `wrangler secret put JWT_SECRET` (CF) and GitHub repo secrets (CI).
- README documents which secrets are required and how to set them.
- Run `gitleaks detect` before each Phase commit.

### Account / resource ID handling

- `wrangler.toml` does NOT include `account_id` (Wrangler picks from login).
- D1 `database_id` and KV `id` are placeholders in committed `wrangler.toml`. Real IDs go in:
  - `wrangler.dev.toml` (gitignored) for local dev
  - GitHub Actions env vars for CI deploy
- Document this pattern in `docs/SELF_HOSTING.md`.

### Forker-ready

A stranger forking the repo must be able to deploy their own in ~10 minutes:

- `docs/SELF_HOSTING.md` with exact wrangler commands
- `.dev.vars.example` with all required secret names (empty values + comments)
- `wrangler.toml` that works after they create their own D1/KV/R2 and update IDs
- Seed script to populate sample missions
- Clear notice in README: portfolio code, PRs welcome but no SLA

### Discoverability

- Repo topics complete (Phase 1)
- Social preview image (Phase 6)
- README links to demo/docs/playground (Phase 6)
- `package.json` `repository`, `homepage`, `keywords` populated
- Each `packages/*/package.json` has full metadata (future npm publish)

### License & legal

- MIT (`LICENSE` in root, not just in README)
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1
- `SECURITY.md` — disclosure email + supported versions table
- `CONTRIBUTING.md` — dev setup, commit conventions, PR process

---

## 12. Session Kickoff Protocol

When I start a new Claude Code session:

1. Read this `CLAUDE.md` end to end.
2. Read `git log --oneline -20` to see what's been done.
3. Run `pnpm install && pnpm build && pnpm test`.
4. Tell me which Phase we're in based on commit history. Propose next 2-3 concrete tasks.
5. Wait for my "go".

---

## 13. Success Criteria

This project succeeds when:

1. A recruiter at TechCombine opens the GitHub repo, lands on the README, and within 30 seconds wants to click the demo link.
2. A senior engineer in a technical interview can drill into any architecture decision and find a documented rationale in `docs/decisions/`.
3. A stranger can fork the repo and deploy their own working copy in 10 minutes using `docs/SELF_HOSTING.md`.
4. The repo is something I'd be proud to link in my LinkedIn header.

Optimize every decision toward those four outcomes.

— Bosso
