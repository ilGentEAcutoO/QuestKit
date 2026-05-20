# Changelog

All notable changes to QuestKit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] — 2026-05-20

Security Hardening release driven by [`instruction/security-review.md`](instruction/security-review.md).
Net result: SonarCloud Security rating C → A, Reliability D → A, no
residual real vulnerabilities. Net of false positives, every finding
the auditor flagged as worth addressing is closed.

### Security

- **`.github/workflows/ci.yml` — `security-events: write` scoped to the
  `verify` job only.** The grant was previously workflow-level, so the
  `newman` job (and any future jobs) inherited write access to GitHub
  Code Scanning despite never uploading SARIF. Now only the gitleaks
  step in `verify` carries the grant. Closes SonarCloud `S8233`.
- **5 GitHub Actions pinned to commit SHAs.** `actions/checkout@v4`,
  `pnpm/action-setup@v4`, `actions/setup-node@v4`,
  `gitleaks/gitleaks-action@v2`, `actions/upload-artifact@v4` —
  full-length SHAs with the original major-version tag preserved as a
  trailing `# v<N>` comment so Dependabot still proposes bumps.
  `SonarSource/sonarqube-scan-action@v6` (new) follows the same pattern.
  Closes `S7637` (×2).
- **Cookie-based auth fallback with CSRF guard** in
  `workers/api/src/auth/middleware.ts`. `requireAuth` now accepts the
  JWT via a `qk_token` cookie when the `Authorization: Bearer` header
  is absent — wider compatibility with HttpOnly-cookie hosts. When the
  token comes from a cookie, the request must include EITHER an
  `Origin` matching `ALLOWED_ORIGINS` (CSV env var) OR a custom
  `X-Requested-With: qk` header. Header-Bearer path is unchanged for
  backwards compatibility. 9 new tests in `auth-cookie.test.ts`.

### Added

- **`workers/api/src/util/redact.ts` — `redactId` helper** + a new
  `workers/api/test/log-redaction.test.ts` (6 tests) that guards every
  `console.warn` against future user-id leaks. Helper keeps the first
  4 chars + `…` + last 2 for ids ≥ 8 chars, masks shorter ids as
  `***`. No current call site embedded a user-id string, but the
  regression net is now in place.
- **CI-based SonarCloud scanning with LCOV coverage.** Replaces the
  Auto Analysis path (which couldn't ingest coverage). New `sonarcloud`
  job in `ci.yml` runs `pnpm test:coverage`, emits six per-package
  `coverage/lcov.info` files, and feeds them to
  `SonarSource/sonarqube-scan-action@v6` via `sonar-project.properties`.
  `@vitest/coverage-istanbul` added as a devDep to
  `workers/{webhook-relay,webhook-consumer}` (workers/api already had
  it). Closes security-review §5.

### Fixed

- **7 `Array.prototype.sort()` calls now pass an explicit
  `localeCompare` comparator** (`workers/api/src/rules/filter.ts`,
  `rules/index.test.ts`, `test/{campaigns,missions}.route.test.ts`).
  Default `.sort()` raised SonarCloud Reliability rating to D via
  `S2871` (×7); behaviour is unchanged because every sorted array is
  lowercase snake_case ids where the locale order matches the default.

### Documentation

- **`CONTRIBUTING.md` — new `## Pre-commit checks` section** covering
  `gitleaks` install via Homebrew / winget / Scoop / `go install`,
  pre-commit hook behaviour, and manual `gitleaks detect --redact`
  usage. Husky hook graceful-degrades when gitleaks isn't on PATH;
  CI is the authoritative gate.
- **`apps/docs/docs/api/auth.md` — new `Cookie-based auth (browser
hosts)` section** documenting the cookie-fallback flow, the CSRF
  guard's Origin / `X-Requested-With` semantics, and `ALLOWED_ORIGINS`
  operator setup.

### SonarCloud triage (user action, no code change)

- 8 findings marked **Won't Fix** with rationale per
  `instruction/security-review.md` §2.1 / §2.2 / §2.4:
  - 3 × `S5852` ReDoS hotspots on base64url char-class regex (regex
    is bounded by JWT format — not user-controlled length).
  - 4 × `S2245` `Math.random` hotspots (defensive fallbacks /
    non-security UI use — never key/token material).
  - 1 × `S6440` React `use` hook in a Playwright fixture (test-only
    pattern; framework supported).

[0.1.3]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.3

## [0.1.2] — 2026-05-20

Live click-through PDCA (the **real** `/frontend-test`) caught that the
demo wasn't actually demonstrating live SDK updates. Three structural
bugs + two demo-content gaps fixed in this release.

### Fixed

- **`packages/core/src/sse.ts` — unbound `fetch`** (THIRD instance of
  the same pattern after polling.ts + client.ts in v0.1.0). The SSE
  client stored the browser's native fetch as a class property and
  called it as a method, throwing `TypeError: Illegal invocation`. The
  error was swallowed by `handleStreamError` → 5 reconnect retries
  all failed → polling fallback kicked in but **the SSE network
  request never actually fired**. The demo's EventLog drawer stayed
  silent on every interaction. Bound `fetch.bind(globalThis)`.
- **`workers/api/src/services/ingest.ts` — no SSE broadcast on event
  ingest.** `ingestEventCore` ran the rule engine and updated mission
  progress in D1, then returned the response WITHOUT broadcasting the
  resulting `mission.progress` / `mission.completed` updates to the
  user's `SSE_HUB` Durable Object. Only the claim route broadcast.
  Mirrored the claim's pattern with a new `tryBroadcastProgress`
  helper. Live updates now reach every subscribed client.
- **`apps/demo/src/routes/ecommerce.tsx` + `streaming.tsx` +
  `daily.tsx` — `<MissionCard>`/`<MissionList>` never wired
  `onClaim`.** The Claim button fired its analytics ping but never
  POSTed to `/v1/missions/:id/claim`. Extracted a shared
  `useMissionClaim` hook in `apps/demo/src/lib` and wired it into all
  three routes; the hook calls `client.claimMission()` and shows the
  resulting reward via the demo toast host.

### Added

- **`?user=<id>` query-param override** on the demo to mint a fresh
  user per session (defaults to `demo_user_42`). The Playwright
  golden-path spec + manual click-through testing need clean state to
  exercise the claim flow without hitting idempotent replay.
- **Migration 0003: Daily Visitor mission** (`daily.login` event,
  count 1, daily window, badge reward). Previously the /daily route's
  Check-in button fired the event but no mission matched, so the rule
  engine returned an empty update list and the EventLog stayed silent.
- **Migration 0004: Lucky Spinner + Scratch Master missions** for the
  /minigames route (`qk.minigame.spin` / `qk.minigame.scratch` events,
  lifetime windows, badge rewards). `minigames.tsx` now fires those
  events from the `onSpin` / `onReveal` callbacks so each interaction
  generates a visible `mission.progress` SDKUpdate in the EventLog
  alongside the existing reward toast.
- **`apps/demo/src/components/icons.tsx`** — shared SVG icons
  (`CoinIcon`, `BadgeIcon`, `GiftIcon`) used by `Layout.tsx` (header
  coin pill) and `DemoToastHost.tsx` (reward toasts). Replaces the
  `🪙` `🏆` `🎁` emojis that rendered inconsistently across OS font
  stacks.
- **SonarCloud quality-gate job** in `.github/workflows/ci.yml` using
  `SonarSource/sonarqube-scan-action@v5` (per plan amendment A22).
  Gated on `secrets.SONAR_TOKEN` so workflows stay green for forks
  without the token. README badge now points at the live SonarCloud
  URL — image goes green on first successful scan.

### Documentation

- `instruction/work/test-report.md` updated with the click-through
  PDCA log: which click triggered which fix, before/after console
  state on all 4 routes.
- 5 stale dependabot PRs closed (TypeScript 6, jest-environment-jsdom
  30, and three GitHub Actions v6 bumps were created against pre-Phase-
  2 base commits and failed CI for unrelated reasons). Dependabot will
  recreate fresh PRs against current main on its next weekly scan.

## [0.1.1] — 2026-05-20

Polish release driven by the post-launch `/frontend-test` PDCA sweep.
Zero functional changes from v0.1.0; only console-hygiene and visual-
consistency fixes.

### Fixed

- **`GET /v1/balance/:currency` now returns 200 + zero-state** instead of
  404 when the user has no row for the requested currency. The 404
  generated noisy "Failed to load resource" entries in every demo
  consumer's console even though the SDK already rendered both states
  as "0". `@questkit/core` `getBalance()` return type tightened from
  `Balance | null` to `Balance`.
- **JWT signature-tamper test flake** — flip the FIRST char of the
  base64url signature (fully-used 6-bit position) instead of the LAST
  (only 4 meaningful + 4 unused bits). CI failed intermittently when
  the unlucky last-char flip only touched unused bits.

### Changed

- **`🪙` / `🏆` / `🎁` reward emojis replaced with inline SVG icons**
  (`apps/demo/src/components/icons.tsx`). Emoji glyphs render
  inconsistently across OS font stacks — Windows shows a grayscale
  pixelated U+1FA99 while macOS/iOS shows the gold coin you'd expect.
  SVG ensures the same brand impression everywhere. Used in both the
  header coin balance pill and the reward toast.

### Test report

See [`instruction/work/test-report.md`](instruction/work/test-report.md)
for the full PDCA log: 4 routes × console hygiene = 0 errors / 0
warnings, 5/5 Playwright golden-path E2E green vs production, 441
unit/integration tests across 6 packages.

[0.1.2]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.2
[0.1.1]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.1

## [0.1.0] — 2026-05-20

First public release. Six-day, six-phase build of an embeddable
Cloudflare-native gamification SDK — React component library, vanilla
JS embed, REST + SSE API, webhook ingestion pipeline, Workers-AI
recommendations — with a live demo at https://questkit.jairukchan.com.

### Added

#### Packages (4 publishable)

- `@questkit/types` — strict TypeScript types for events, missions,
  rewards, balances, campaigns, and the SDKUpdate discriminated union.
- `@questkit/core` — framework-neutral SDK: `QuestKitClient`, rule
  engine (`daily`/`weekly`/`lifetime` windows + filter clauses), event
  queue with retry, SSE client with reconnect + polling fallback, idem-
  potency. 87 Jest tests.
- `@questkit/react` — React component library (peer-dep `^18.3 || ^19`):
  `QuestKitProvider`, hooks (`useMissions`, `useMission`, `useBalance`,
  `useEvent`, `useCampaign`, `useRecommendations`), components
  (`MissionList`, `MissionCard` with `iconUrl` render, `CoinBalance`,
  `CampaignBanner`, `RewardClaimToast`, `ProgressBar`,
  `RecommendedMissions`), and mini-games (`SpinWheel`, `ScratchCard`).
  125 RTL tests.
- `@questkit/embed` — vanilla `<script>` IIFE bundle (~59 KB gz),
  Shadow-DOM isolated, mounts on `data-questkit` attribute, re-mounts
  on `qk:reinit` events for SPA hosts. 21 tests.

#### Workers (6 deployed)

- `questkit-worker-api` — Hono REST + SSE on
  `api.questkit.jairukchan.com`. Bindings: D1 (truth), KV (idempotency
  - JWT denylist), R2 (assets), Durable Objects (`RateLimiter` SQLite
    sliding-window + `SSEHub` ReadableStream fanout), Queue (producer),
    Analytics Engine, Workers AI
    (`@cf/meta/llama-3.1-8b-instruct-fast`). 165 vitest tests via
    `@cloudflare/vitest-pool-workers`.
- `questkit-worker-webhook-relay` — Stripe-style HMAC verification +
  Cloudflare Queue producer at `webhook.questkit.jairukchan.com`.
- `questkit-worker-webhook-consumer` — Queue consumer that invokes the
  api via `WorkerEntrypoint` RPC (typed, zero-serialization). DLQ with
  `max_retries: 5`, exponential backoff.
- `questkit-worker-demo` — Vite SPA at `questkit.jairukchan.com` with
  4 scenarios (e-commerce, streaming, daily, mini-games), 3 floating
  panels (DevTools, AIRecommendations, EventLog), inline /api/token
  proxy. All 5 routes meet Lighthouse mobile gates ≥ 0.92 perf, 1.00
  a11y, 1.00 best-practices.
- `questkit-worker-docs` — Docusaurus 3.10.1 SSG at
  `docs.questkit.jairukchan.com`. 36 routes. Tailwind v4 via custom
  PostCSS plugin.
- `questkit-worker-play` — vanilla-embed playground at
  `play.questkit.jairukchan.com` (plain HTML / WordPress mock /
  iframe).

#### Documentation

- 31-page Docusaurus site (concepts, react, embed, api, webhooks, faq,
  theming, self-hosting).
- 6 ADRs (`docs/decisions/`): Cloudflare-only stack, React over Vue,
  SSE over WebSockets, DOs for rate-limiting, Workers AI for
  personalisation, test boundaries (service stubs vs `cloudflare:test`
  pool-workers).
- `docs/CLOUDFLARE_SETUP.md` + `docs/SELF_HOSTING.md` + interactive
  `scripts/setup.sh` for 10-minute self-host on a clean account.
- README v1 (272 lines) with mermaid architecture diagram, 6 shields
  badges, dual quick-starts (React + embed), tech stack table.
- 1280×640 social-preview PNG + 12-second demo GIF generated via MCP
  Playwright.
- 5-scenario Playwright E2E smoke spec running against either local
  dev or live prod (`E2E_TARGET=prod`). 5/5 green vs production.

#### CI / Hygiene

- GitHub Actions workflow: lint, typecheck, test, gitleaks (with
  custom allowlist), Newman API contract tests (40 assertions across
  20 requests).
- Conventional Commits, MIT license, Code of Conduct (Contributor
  Covenant 2.1), Security disclosure policy, dependabot weekly bumps.
- `gitleaks.toml` configured to scan history; `pnpm` overrides pin
  patched versions for transitive `serialize-javascript`,
  `http-proxy-agent`, `ws`.

### Fixed

Four production bugs caught during first live demo→api traffic (all
hidden by mock-heavy unit tests):

- **`PollingClient` unbound `setInterval`/`clearInterval`** — storing
  the browser timer as a class property then calling it as a method
  invoked it with `this === PollingClient`, which the browser rejects
  with `TypeError: Illegal invocation`. Crashed the SSE→polling fallback
  path entirely.
- **`QuestKitClient` unbound `fetch`** — same root cause as above. All
  `authedFetch` calls (campaigns / missions / balance / recommendations)
  silently threw. Surfaced as "Couldn't load campaign" / "Couldn't load
  missions" alerts in the demo. Bound `fetch.bind(globalThis)` in the
  constructor.
- **`QuestKitClient.authedFetch` single-shot 401 retry** — defensive
  production-grade SDK pattern: if the first attempt's token is stale
  or empty (race on first mount, expired since cache, server rotated
  `JWT_SECRET`), refetch the token via `getToken()` and replay. Bubbles
  up only if the retry also 401s.
- **`questkit-worker-api` missing CORS middleware** — plan.md §5 specced
  "SDK runs on any host" but no `hono/cors` was ever wired. Added
  `app.use('*', cors({ origin: '*', allowMethods: GET/POST/OPTIONS,
allowHeaders: Content-Type/Authorization/Idempotency-Key, maxAge:
86400, credentials: false }))`.

Plus:

- `MissionCard` now renders `mission.iconUrl` as a 32×32 decorative
  `<img>` (`alt=""` + `aria-hidden="true"`, `loading="lazy"`,
  `decoding="async"`, explicit dims for CLS prevention).
- Docusaurus SSG unblocked via a three-layer fix: `null-loader` on
  `.css` + `client-modules.js`, `future.faster.swcJsLoader: true` +
  `@swc/core` devDep, removing `"type": "module"` from
  `apps/docs/package.json`. 36/36 routes render.
- `apps/docs/docusaurus.config.ts` migrated from top-level
  `onBrokenMarkdownLinks` to `markdown.hooks.onBrokenMarkdownLinks`
  (Docusaurus v4 forward-compat).
- Newman CI unblock chain (8 commits): bash prefires → bot-management
  bypass → Newman-native collection prefires → `pm.variables` scope
  fix → SSE folder removal. End state: 40/40 assertions pass.
- 3 dependabot vulnerabilities closed via `pnpm.overrides`:
  `serialize-javascript@^7.0.5` (HIGH RCE + MEDIUM DoS),
  `http-proxy-agent@^7.0.0` (drops `@tootallnate/once` LOW), and
  `ws@^8.20.1` (auto-dismissed MEDIUM memory disclosure).
- JWT signature-tamper test fix: flip the FIRST char of the base64url
  signature (fully-used 6-bit position) instead of the last (4 unused
  bits → intermittent CI flake when the unlucky path hits unused bits).

### Infrastructure

- Custom domains wired via `wrangler.jsonc` `routes[].custom_domain:
true`. CF auto-provisions DNS + SSL on first deploy. All 5 worker
  URLs return HTTPS 200.
- `APP_SECRET` rotation synchronised across api worker / demo worker /
  GitHub Actions secret `QUESTKIT_APP_SECRET`.

[0.1.0]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.0

<!-- Diff: https://github.com/ilGentEAcutoO/QuestKit/compare/v0.1.0...v0.1.1 -->
