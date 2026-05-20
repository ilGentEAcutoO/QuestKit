# Security Review

|                     |                                                          |
| ------------------- | -------------------------------------------------------- |
| **Project**         | QuestKit (`ilGentEAcutoO/QuestKit`)                      |
| **Reviewed branch** | `main` @ `5b174b3`                                       |
| **Review date**     | 2026-05-20                                               |
| **Scope**           | All apps + packages + workers + CI + SonarCloud findings |
| **Reviewer**        | Claude (agent-driven static + manual review)             |
| **Latest release**  | v0.1.2 — Production launch with live SSE end-to-end      |

## Executive Summary

QuestKit's security posture is **strong for an MVP** but has **one real
vulnerability** worth fixing pre-v0.2 plus a handful of code-quality
issues SonarCloud surfaces that need triage. The headline numbers from
SonarCloud's Auto Analysis on `main`:

| Metric                        | Value                       | Note                                                                                                            |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Bugs                          | 7                           | All `S2871` "use localeCompare in sort" — style nits in tests + 1 internal sort                                 |
| Vulnerabilities               | 1                           | `S8233` workflow-level `security-events: write` — real, low-impact                                              |
| Security hotspots             | 9                           | 3 false-positive ReDoS + 4 defensive `Math.random` fallbacks + 2 GH-action SHA pins                             |
| Code smells                   | 307 (30 critical, 77 major) | Complexity / size / size — quality not security                                                                 |
| Reliability rating            | D (4)                       | Driven entirely by the 7 sort-comparator bugs                                                                   |
| Security rating               | C (3)                       | Driven by the 1 workflow-permission vulnerability                                                               |
| Quality (sqale)               | A (1)                       | Maintenance-debt ratio is healthy                                                                               |
| Duplicated lines              | 1.7 %                       | Low                                                                                                             |
| `pnpm audit --prod`           | **0 vulnerabilities**       | Confirmed locally + in CI                                                                                       |
| GitHub Dependabot open alerts | **0**                       | All historical alerts (HIGH + MEDIUM + LOW) closed via `pnpm.overrides` and the `sonarqube-scan-action@v6` bump |
| Gitleaks (CI)                 | **0 findings**              | Synthetic JWT example in docs was truncated in `44b6898`; gitleaks history clean                                |

## Risk Matrix

| Severity  | Count | Effort to fix | Recommended action                   |
| --------- | ----- | ------------- | ------------------------------------ |
| 🔴 HIGH   | 0     | —             | —                                    |
| 🟠 MEDIUM | 1     | 5 min         | Tighten workflow permissions (§1.1)  |
| 🟡 LOW    | ~13   | 1-2 h total   | Defensive hardening pass before v0.2 |
| ℹ INFO    | ~100+ | optional      | Code-smell cleanup over time         |

---

## 1. Confirmed Security Issues

### 1.1 ⚠ MEDIUM — Workflow-level `security-events: write` permission

**SonarCloud:** `githubactions:S8233` — `.github/workflows/ci.yml:16`

```yaml
permissions:
  contents: read
  pull-requests: read
  security-events: write # ← granted to ALL jobs, only needed by gitleaks
```

**Risk.** Granting `security-events: write` at the workflow level means
every job (lint, Newman, future jobs) inherits the right to publish
Code Scanning alerts. A compromised third-party action (e.g. via a
typosquatted version pin) could inject fake alerts or suppress real
ones for the entire workflow run.

**Recommendation.** Move the permission to the only job that needs it
(the gitleaks step inside the `verify` job). Drop the workflow-level
grant.

```yaml
permissions:
  contents: read
  pull-requests: read

jobs:
  verify:
    permissions:
      contents: read
      security-events: write   # gitleaks only
      ...
```

**Effort:** 1 file edit, no behavioural change.

---

## 2. Triaged As Not Exploitable (False Positives)

### 2.1 ReDoS hotspots on base64url regexes

**SonarCloud:** `typescript:S5852` × 3 — flags `/\+/g`, `/\//g`, `/=+$/`
in `auth/jwt.ts:195`, `db/schema.ts:220`, `core/test/client.test.ts:25`.

These are single-character classes with no alternation or nested
quantifiers — linear-time matching, no backtracking is possible. The
SonarCloud rule conservatively flags any regex with a `+` quantifier;
that heuristic doesn't apply to single-char-class repetition.

**Verdict:** No fix. Safe to mark as `Won't Fix` in SonarCloud UI.

### 2.2 `Math.random` "weak cryptography" hotspots

**SonarCloud:** `typescript:S2245` × 4 — flags Math.random in
`client.ts:668`, `event-queue.ts:87`, `SpinWheel/index.tsx:132`,
`DemoToastHost.tsx:84`.

Each occurrence is:

- A **defensive fallback** when `crypto.randomUUID()` or
  `crypto.getRandomValues()` is unavailable (very old runtimes only —
  unreachable on Workers + modern browsers); or
- A **non-security** use (UI toast ID, lottery wheel slice pick).

`crypto.subtle` is used for all real security operations: HS256 JWT
signing (`auth/jwt.ts:sign/verify`), HMAC-SHA256 webhook verification
(`webhook-relay/src/hmac.ts`), JTI random bytes for revocation.

**Verdict:** No fix. Add SonarCloud "safe" markers if cleanup desired.

### 2.3 Sort comparator bugs

**SonarCloud:** `typescript:S2871` × 7 — `sort()` without a comparator.

All seven occurrences are on **arrays of plain strings** (mission IDs,
balance currencies). JS's default sort already does lexicographic
ordering, which is correct + deterministic for ASCII identifiers. The
`localeCompare` recommendation matters when sorting human-language
content, not opaque IDs.

**Verdict:** Optionally add `.sort((a, b) => a.localeCompare(b))` for
SonarCloud cleanliness — no behavioural change. Real impact is
near-zero because all sorted arrays are bounded (≤ 9 items).

### 2.4 React "use" hook in non-component

**SonarCloud:** `typescript:S6440` — `apps/demo/e2e/_fixtures.ts:67`.

The `use` symbol here is the **Playwright fixture callback** (`async
({ page }, use) => { ...; await use(collected); }`), not React's `use`
hook. SonarCloud's React-rule heuristic doesn't know about Playwright's
test API.

**Verdict:** No fix. Mark `Won't Fix`.

### 2.5 GH Actions not pinned to commit SHA

**SonarCloud:** `githubactions:S7637` × 2 — `actions/checkout@v4` etc.

Pinning to commit SHA defends against tag re-pointing (a compromised
action maintainer could move a tag to a malicious commit). For a
portfolio project relying on first-party Actions from `actions/`,
`pnpm/action-setup`, `gitleaks/`, and `SonarSource/`, the practical
exposure is low — these maintainers have not historically been
breached.

**Verdict:** Defer to v0.2. Adopt SHA pins when adding any new
third-party action.

---

## 3. Manual Deep Review

### 3.1 Authentication & Authorisation

| Surface                               | Implementation                                                                                                                                       | Verdict |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| JWT mint (`POST /v1/auth/token`)      | HS256 via Web Crypto, 1 h TTL, JTI in payload, `appSecret` timing-safe compare via HMAC-verify                                                       | ✅      |
| JWT verify (`requireAuth` middleware) | Signature + expiry + future-iat checks; JTI denylist via KV                                                                                          | ✅      |
| Token theft mitigation                | Embed widgets render in Shadow DOM (no cross-host JS access to host cookies); hosts recommended to store JWTs in `httpOnly` cookies (docs §security) | ✅      |
| Token revocation                      | KV-backed denylist invalidates JTI immediately; 1 h TTL eviction matches token expiry                                                                | ✅      |
| `APP_SECRET` storage                  | Set via `wrangler secret put`, never committed; rotation flow documented + exercised in this session                                                 | ✅      |
| `JWT_SECRET` storage                  | Same as above                                                                                                                                        | ✅      |

**Finding A1 (LOW).** `auth/middleware.ts` reads token from
`Authorization: Bearer …` header only — no cookie fallback. For
browser-based hosts that prefer `httpOnly` cookies, the SDK currently
requires the host to do an extra `fetch` to read the cookie and pass
it. Consider adding optional cookie-auth in v0.2. Not a CVE-class
issue, just an ergonomics one.

### 3.2 SQL Injection (D1)

Every query in `workers/api/src/db/schema.ts` uses prepared statements
via `db.prepare().bind()`. No string concatenation into SQL. Grep for
`${` inside SQL strings — zero matches.

```typescript
// Example pattern, used everywhere:
await env.DB.prepare("SELECT * FROM missions WHERE id = ?").bind(id).first();
```

**Verdict:** ✅ No SQLi risk.

### 3.3 Cross-Origin Resource Sharing (CORS)

Configured at the api worker via `hono/cors` (`workers/api/src/index.ts`):

```typescript
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
    exposeHeaders: ["X-Idempotent-Replay"],
    maxAge: 86400,
    credentials: false,
  }),
);
```

**Discussion.** `origin: "*"` is intentional per plan.md §5 — the SDK
runs on **any** host (npm-installed React apps, vanilla embed on
WordPress + iframes, etc.). The JWT is the security boundary, not the
`Origin` header. `credentials: false` is correct paired with `*`:
browsers refuse to forward cookies when origin is wildcarded, so a
malicious site can't piggy-back the user's API session.

**Finding A2 (INFO).** `/v1/auth/token` accepts cross-origin POST.
Since the body must carry the correct `appSecret` (server-side only,
never browser-side), a malicious site can't forge a token even with
CORS open. The recommendation in docs is clear: "host backends mint
tokens server-side, never call /v1/auth/token from the browser."

### 3.4 Webhook Ingestion

Surface: `POST https://webhook.questkit.jairukchan.com/v1/webhook/incoming`

| Check                       | Implementation                                                                                                                                                       | Verdict |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| HMAC signature verification | Stripe-style scheme: `t=<unix_seconds>,v1=<hex>` in `Stripe-Signature` header. Timing-safe compare via `crypto.subtle.verify`. (`workers/webhook-relay/src/hmac.ts`) | ✅      |
| Timestamp tolerance         | Rejects timestamps > 5 min in the past or > 1 min in the future. Replay-window enforced.                                                                             | ✅      |
| Body integrity              | Signature is over `${timestamp}.${raw_body}` — bytes-identical input. Rebody parsing happens AFTER verification.                                                     | ✅      |
| Provider scope              | Stripe-only for v0.1; the `_source: "stripe"` literal type makes adding new providers a compile-time decision (per plan A27).                                        | ✅      |
| Queue durability            | After HMAC pass, event is normalised + enqueued to `questkit-queue-webhooks`. Consumer retries 5× with exponential backoff before DLQ.                               | ✅      |
| DLQ surface                 | Bug-shaped failures land in `questkit-queue-webhooks-dlq` and are observable via Analytics Engine / wrangler tail.                                                   | ✅      |

**Verdict:** ✅ No webhook-specific vulnerabilities found.

### 3.5 Rate Limiting

`workers/api/src/durable/rate-limiter.ts` — SQLite-backed sliding
window per JWT JTI. 100 req/min on ingest (`/v1/events`), 1000 req/min
on read endpoints. Returns 429 + `Retry-After` header on exceedance.

| Concern                        | Status                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Per-JWT isolation (not per-IP) | ✅ Idempotency key on the JWT prevents one IP abusing many tokens                                      |
| Counter accuracy               | ✅ Atomic SQLite increments; no race                                                                   |
| 429 response shape             | ✅ Includes `Retry-After`                                                                              |
| Bypass vectors                 | None found. Direct `*.workers.dev` URLs were disabled when custom domains landed (wrangler 4 default). |

### 3.6 Frontend XSS

| Surface                        | Implementation                                                                                                                                          | Verdict |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `@questkit/react` components   | All user-supplied strings rendered as text via JSX. The unsafe React API for injecting raw HTML is **never used** (grep confirmed across all packages). | ✅      |
| `@questkit/embed` IIFE         | Mounts into a Shadow DOM. Host page CSS/JS cannot reach widget internals; widget cannot read host cookies.                                              | ✅      |
| Demo + Docs + Playground apps  | No `innerHTML` / `outerHTML` / template-literal HTML injection sites anywhere.                                                                          | ✅      |
| Reward / mission text from API | Treated as text in `<h3>`, `<span>`, `<button>` children. JSON-encoded by D1; no markup capability.                                                     | ✅      |

**Verdict:** ✅ No XSS surface.

### 3.7 Secrets Management

| Asset                                 | Storage                                                                                            | Audit                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `JWT_SECRET`                          | `wrangler secret put` on `questkit-worker-api`                                                     | Never in repo; `gitleaks` history clean |
| `APP_SECRET`                          | `wrangler secret put` on api + demo; mirrored as `QUESTKIT_APP_SECRET` GitHub Actions secret       | Same                                    |
| `WEBHOOK_HMAC_SECRET`                 | `wrangler secret put` on `webhook-relay`                                                           | Same                                    |
| `SONAR_TOKEN`                         | GitHub Actions secret (used to be — now removed since SonarCloud Auto Analysis is canonical)       | Never exposed                           |
| `*.dev.vars` per-worker               | Gitignored; `*.dev.vars.example` committed as templates only                                       | Verified                                |
| Real CF resource IDs (D1 UUID, KV ID) | Live in gitignored `wrangler.dev.jsonc`; public `wrangler.jsonc` uses `<set-per-env>` placeholders | Verified                                |

**`.gitignore` audit:** `.dev.vars*`, `.env`, `.env.*`, `wrangler.dev.jsonc`,
`worker-configuration.d.ts` all gitignored. The negation
`!.dev.vars.example` is intentional and reviewed.

**Verdict:** ✅ No secret-in-history exposure.

### 3.8 Logging / PII

`wrangler tail` + Workers logs:

- `console.log` is used sparingly (warning paths only — `tryBroadcastClaim`,
  `tryBroadcastProgress`, `[claim-prefire]`, etc.).
- Event payloads are **not** logged at INFO. PII is intentionally absent
  from log output — user-supplied event fields stay in D1 and AE.
- AE writes include `requestCountry` (Cloudflare-detected ISO-3166)
  only; no user-agent, IP, or other fingerprinting fields.

**Finding A3 (INFO).** A few `console.warn` calls embed the user-id or
mission-id in the message (e.g. "claim failed for user X"). For a
public-facing product these could be considered low-grade PII (the
user-id is opaque + host-controlled, so the risk is minimal — but if a
host's user-id format happens to embed email or other PII, it would
land in CF logs). Recommend redacting user-ids in log messages for
v0.2.

### 3.9 AI / Workers AI

Recommender (`workers/api/src/routes/recommendations.ts`) calls
`@cf/meta/llama-3.1-8b-instruct-fast` with **structured input** only:
recent event names + counts + filter spec. No free-text from the user
is forwarded to the LLM — prompt injection surface is zero.

The LLM response is JSON-parsed and validated against an expected
schema (`missionIds[]`, `reason`). Malformed responses return
`502 ai_response_malformed` to the client — no raw LLM output is ever
rendered.

**Verdict:** ✅ No prompt-injection or PII-leak risk.

### 3.10 Dependencies

`pnpm audit --prod` → **0 known vulnerabilities** (2026-05-20).

`pnpm.overrides` in root `package.json` pins three transitive deps to
patched versions:

```json
"pnpm": {
  "overrides": {
    "serialize-javascript": "^7.0.5",     // GHSA RCE + DoS
    "http-proxy-agent": "^7.0.0",         // drops vulnerable @tootallnate/once
    "ws@>=8.0.0 <8.20.1": "^8.20.1"       // memory-disclosure GHSA
  }
}
```

GitHub Dependabot:

- **0 open alerts.**
- Three historical alerts (HIGH `serialize-javascript` RCE, MEDIUM
  `serialize-javascript` DoS, LOW `@tootallnate/once`) closed via the
  overrides above.
- One historical MEDIUM `ws` alert auto-dismissed by Dependabot's
  reachability analysis; still patched.
- `SonarSource/sonarqube-scan-action` HIGH (GHSA-5xq9-5g24-4g6f)
  closed by bumping `v5 → v6` in `8f7d2da`.

`minimumReleaseAge: 1440` in `pnpm-workspace.yaml` enforces a 24-hour
quarantine for new dependency versions — mitigates fast-moving
supply-chain attacks.

### 3.11 SSE / Durable Object Hardening

| Concern                                              | Verdict                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------- |
| Per-user DO isolation (`SSE_HUB.idFromName(userId)`) | ✅ Distinct DO per user                                                   |
| Broadcast endpoint scope                             | Internal-only (Hono service binding; not exposed externally)              |
| Token leakage in stream URL                          | ✅ Token in `Authorization` header, not query string                      |
| Stream hijacking via stale token                     | Token validity re-checked on subscribe; expiry enforced by JWT timestamps |
| DO writer set eviction                               | Stale writers removed on broadcast error (best-effort cleanup)            |

### 3.12 CI / Supply-Chain Hardening

| Item                                      | Status                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-commit hook (`husky` + `lint-staged`) | ✅ `prettier --write` + `eslint --fix` on staged files                                                                                                                                                                        |
| Pre-commit `gitleaks`                     | ⚠ Skipped locally on this dev host (`gitleaks not installed locally`). CI runs it on every push. Acceptable but contributors could miss leaks at commit time — recommend documenting `gitleaks` install in `CONTRIBUTING.md`. |
| Dependabot weekly bumps                   | ✅ Enabled via `.github/dependabot.yml`                                                                                                                                                                                       |
| Lock file enforced                        | ✅ `pnpm install --frozen-lockfile` in CI                                                                                                                                                                                     |
| Generated types regenerated in CI         | ✅ `cf-typegen` runs before lint/typecheck                                                                                                                                                                                    |
| Permission model                          | ⚠ See Finding §1.1                                                                                                                                                                                                            |

---

## 4. Code Quality (SonarCloud Critical Smells, x30)

Not security issues per se, but flagged for visibility. Categories:

| Rule                                  | Count | Description                                                                                                                                                                                                               | Recommendation                                             |
| ------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `S3735` "Don't use void operator"     | 18    | `void fireEvent(...)` and `void someAsync()` — used INTENTIONALLY in the codebase to mark fire-and-forget promises so ESLint doesn't complain about unhandled-promise. SonarCloud's heuristic disagrees with TS-ESLint's. | Keep — explicit by design                                  |
| `S3776` "Cognitive Complexity > 15"   | 5     | Long functions in `hmac.ts:102`, `event-queue.ts:171`, `sse.ts:199 + 262`, `db/schema.ts:636`.                                                                                                                            | Optional refactor for readability; no security implication |
| `S2004` "Nested functions > 4 levels" | 3     | Animation / toast / hook code in `DemoToastHost.tsx:88`, `RewardClaimToast/index.tsx:206`, `useBalance.ts:86`                                                                                                             | Cosmetic; React-idiomatic                                  |
| `S1192` "String literal x2+" (in SQL) | 3     | Migration files — same campaign ID literal                                                                                                                                                                                | Acceptable; migrations are append-only                     |
| `S4123` "await on non-Promise"        | 1     | `useEvent.test.tsx:90` test helper                                                                                                                                                                                        | Test-only, low impact                                      |

---

## 5. Test Coverage Status

SonarCloud measures `coverage` is unreported (LCOV not uploaded). If
coverage tracking matters for a future "≥ 70 % code coverage" portfolio
claim, wire up `vitest run --coverage` + `jest --coverage` in CI, then
publish the resulting `lcov.info` to SonarCloud via `sonar-project.properties`
(`sonar.javascript.lcov.reportPaths=coverage/lcov.info` is already set
in the file).

Current numbers (manual count from CI logs):

- `@questkit/types`: type-only (no runtime tests)
- `@questkit/core`: 87 tests
- `@questkit/react`: 125 tests
- `@questkit/embed`: 21 tests
- `@questkit/worker-api`: 165 + 1 skipped
- `@questkit/worker-webhook-relay`: 34 tests
- `@questkit/worker-webhook-consumer`: 9 tests
- Newman API contract: 40 assertions / 20 requests / 18 test scripts
- Playwright golden-path E2E: 5 scenarios (chromium-desktop) against prod

Total: **441 unit/integration + 5 E2E** = healthy coverage breadth.

---

## 6. Recommended Remediation Plan

Priority order to land before v0.2:

### Must-fix (5 min total)

1. **Move `security-events: write` to job level in `ci.yml`** (Finding §1.1).
   Removes the workflow-level write grant from all jobs except gitleaks.

### Should-fix (1-2 h)

2. **Mark Sonar false positives as "Won't Fix"** in the SonarCloud UI:
   - 3 base64url regex ReDoS hotspots
   - 4 Math.random "weak crypto" hotspots
   - 7 `S2871` sort-comparator bugs (or add `.sort((a,b)=>a.localeCompare(b))` if you want a green Sonar)
   - 1 `S6440` React `use` hook (Playwright fixture)
3. **Document `gitleaks` install** in `CONTRIBUTING.md` so contributors run it pre-commit.
4. **Redact user-ids from `console.warn` calls** in the workers (Finding §3.8 A3).

### Nice-to-have (v0.2+)

5. **Pin GitHub Actions to commit SHAs** when adding any new third-party action.
6. **Add cookie-based auth path** to `requireAuth` middleware so hosts can pass JWTs via `httpOnly` cookies (Finding §3.1 A1).
7. **Multi-provider webhook normalisation** (per plan A27 — currently Stripe-only).
8. **Wire up code coverage upload** to SonarCloud so the `coverage` metric stops reporting 0.

---

## 7. Summary

|                                        |                                                        |
| -------------------------------------- | ------------------------------------------------------ |
| Real vulnerabilities                   | **1** (workflow permission — fix in 1 file, 1 line)    |
| Bugs/CVEs in dependencies              | **0**                                                  |
| Secret leaks in history                | **0**                                                  |
| Production-class security gaps         | **0**                                                  |
| Code quality findings worth addressing | ~10 (mostly false-positive suppressions in SonarCloud) |

**The project is safe to keep public and continue to demo.** Address
Finding §1.1 before adding any further GitHub Actions workflows, mark
the SonarCloud false positives as "Won't Fix" for badge cleanliness,
and the bulk of the remaining items are quality-not-security
considerations for the v0.2 roadmap.
