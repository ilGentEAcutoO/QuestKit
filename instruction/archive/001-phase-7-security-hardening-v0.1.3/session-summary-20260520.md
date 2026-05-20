# Session Summary — Phase 7 / v0.1.3 Security Hardening

> Date: **2026-05-20**
> Final tag: **`v0.1.3`** at commit `88243d2`
> Phase status: 🟢 closed (8/8 tasks completed)
> Release: <https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.3>

---

## 1. Headline

QuestKit shipped **v0.1.3 — Security Hardening** in a single session: 9 commits, 1 tag, 1 GitHub Release. Every actionable finding from `instruction/security-review.md` is closed. SonarCloud quality gate is **OK** with all three ratings at **A** (Security flipped C→A, Reliability flipped D→A, Maintainability remained A). Test coverage now reports **76.9%** — the first scan that reports a real number, after switching SonarCloud from Auto Analysis to CI-based scanning.

---

## 2. Tasks completed

| ID       | Title                                                    | Commit      | Closes                          |
| -------- | -------------------------------------------------------- | ----------- | ------------------------------- |
| TASK-035 | Scope `security-events:write` to verify job only         | `feace60`   | sec-rev §1.1 / Sonar `S8233`    |
| TASK-036 | Add `localeCompare` to 7 `Array.prototype.sort()` sites  | `18cc69a`   | sec-rev §2.3 / Sonar `S2871` ×7 |
| TASK-037 | Mark 7 false-positive findings as Won't Fix              | (UI triage) | sec-rev §2.1 / §2.2 / §2.4      |
| TASK-038 | Pin 5 GitHub Actions to commit SHAs                      | `086827d`   | sec-rev §2.5 / Sonar `S7637` ×2 |
| TASK-039 | Document `gitleaks` install in `CONTRIBUTING.md`         | `7d6e1f1`   | sec-rev §3.12                   |
| TASK-040 | Add `redactId` helper + log-redaction safety net         | `4c174fc`   | sec-rev §3.8 A3                 |
| TASK-041 | Cookie-based auth fallback in `requireAuth` + CSRF guard | `c6f56f5`   | sec-rev §3.1 A1                 |
| TASK-042 | Switch SonarCloud to CI-based + wire LCOV coverage       | `4c3aefd`   | sec-rev §5                      |

Plus the release artifacts:

| Commit    | Purpose                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------- |
| `1a4350a` | `docs(changelog): v0.1.3 — Security Hardening release notes`                                       |
| `88243d2` | `chore(todos): close out Phase 7 with v0.1.3 triage` — **tagged as `v0.1.3`**                      |
| `ef7db12` | `docs(env): note ALLOWED_ORIGINS placement in .dev.vars.example` (post-release env-sync follow-up) |

---

## 3. Test + verification results

### Local final verification (2026-05-20 post-release)

| Check                                  | Result                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `pnpm lint`                            | ✅ 10/10 tasks                                                            |
| `pnpm typecheck`                       | ✅ 14/14 tasks                                                            |
| `pnpm test`                            | ✅ 10/10 tasks, **456 passed / 1 skipped** total                          |
| └ `workers/api`                        | 180 passed / 1 skipped (was 165 baseline; +15 = 6 redact + 9 cookie-auth) |
| └ `packages/core`                      | 87                                                                        |
| └ `packages/react`                     | 125                                                                       |
| └ `packages/embed`                     | 21                                                                        |
| └ `workers/webhook-relay`              | 34                                                                        |
| └ `workers/webhook-consumer`           | 9                                                                         |
| `pnpm audit --prod --audit-level=high` | ✅ 0 findings                                                             |
| `pnpm test:coverage`                   | ✅ all 6 packages emit `coverage/lcov.info`                               |
| Working tree                           | ✅ clean                                                                  |

### CI run (`26155637696`, commit `1a4350a`)

| Job                           | Duration | Result                             |
| ----------------------------- | -------- | ---------------------------------- |
| Lint, typecheck, test         | 1m 27s   | ✅                                 |
| Newman API contract tests     | 30s      | ✅ (Phase-2 carry-over unblocked)  |
| SonarCloud scan with coverage | 1m 57s   | ✅ (first CI-based scan with LCOV) |

### SonarCloud (post-triage, 2026-05-20)

| Metric                 | Before Phase 7                  | After v0.1.3 + triage       |
| ---------------------- | ------------------------------- | --------------------------- |
| Quality gate           | OK (with debt)                  | **OK (clean)**              |
| Security rating        | C                               | **A**                       |
| Reliability rating     | D                               | **A**                       |
| Maintainability rating | A                               | A                           |
| Coverage               | 0% (Auto Analysis can't ingest) | **76.9%** (CI-based + LCOV) |
| Bugs                   | 8+                              | **0**                       |
| Vulnerabilities        | 0                               | 0                           |
| Security hotspots open | 8                               | **0**                       |

---

## 4. Security status (independent final audit)

- `pnpm audit --prod --audit-level=high` → 0 findings
- Secret grep across Phase 7 diff (`4768f1e..ef7db12`) → no real secret values; only env-var names, GitHub Actions `${{ secrets.* }}` references, JSDoc / CHANGELOG prose, and deterministic test placeholders explicitly marked `_do_not_use_in_prod_`
- `.gitignore` audit → `.dev.vars*` correctly ignored with `!.dev.vars.example` allowlist; `wrangler.dev.jsonc` ignored both root and workers/api/
- `gitleaks-action@ff98106…` runs in CI on every push under the new job-level `security-events: write` grant; SARIF uploads to GitHub Code Scanning
- Cookie-based auth (TASK-041) ships with a layered CSRF guard: Origin allowlist OR `X-Requested-With: qk` custom header; Bearer-header path unaffected (forward-compatible for all existing SDK / Newman / e2e callers)

**Verdict: SHIP-READY.** Confirmed by parallel sub-agent audit.

---

## 5. Files changed (high-level)

Phase 7 touched 27 files across 9 commits, +837 / −117 net.

**Workers**:

- `workers/api/src/auth/middleware.ts` — cookie fallback + CSRF guard
- `workers/api/src/util/redact.ts` (new) — `redactId(id)` helper
- `workers/api/src/env.d.ts` — `ALLOWED_ORIGINS` type
- `workers/api/wrangler.jsonc` — `vars` block declaring `ALLOWED_ORIGINS`
- `workers/api/vitest.config.ts` — test binding for `ALLOWED_ORIGINS`; `lcov` reporter
- `workers/api/src/rules/filter.ts` + 3 test files — `localeCompare` comparator
- `workers/{webhook-relay,webhook-consumer}/vitest.config.ts` — `lcov` reporter + `@vitest/coverage-istanbul` devDep
- `workers/api/test/{auth-cookie,log-redaction}.test.ts` (new, +15 tests)

**CI / Build**:

- `.github/workflows/ci.yml` — job-level perms, 5 + 1 new actions pinned to SHA, `sonarcloud` job re-enabled with v6 scan-action + LCOV upload
- `sonar-project.properties` — 6-path CSV in `sonar.javascript.lcov.reportPaths`
- `turbo.json` — `test:coverage` task
- Root + per-package `package.json` — `test:coverage` scripts
- `pnpm-lock.yaml` — `@vitest/coverage-istanbul`

**Docs**:

- `CHANGELOG.md` — v0.1.3 section (80 lines)
- `CONTRIBUTING.md` — `## Pre-commit checks` section (gitleaks install paths)
- `apps/docs/docs/api/auth.md` — Cookie-based auth section
- `.dev.vars.example` (root + workers/api) — discoverability note for `ALLOWED_ORIGINS`
- `instruction/work/todos.md` — phase 7 task tracking

---

## 6. Key lessons / notable decisions

1. **Cookie auth CSRF guard is layered, not single-strategy** — `Origin` allowlist OR custom `X-Requested-With: qk` header. Either suffices on its own. The header alone is enough because cross-origin attackers cannot set arbitrary custom headers without triggering CORS preflight, and the SDK can always send it. The Origin allowlist exists for hosts that prefer same-origin enforcement. Documented in `apps/docs/docs/api/auth.md`.

2. **`ALLOWED_ORIGINS` is a non-secret `vars` entry, not a `.dev.vars` secret** — Cloudflare Workers split env into secrets (`.dev.vars` + `wrangler secret put`) and non-secrets (`wrangler.jsonc` `vars`). The CSRF allowlist is operator config, not credential material, so it lives in the public `wrangler.jsonc`. The `.dev.vars.example` files gained a discoverability comment pointing operators at the right file.

3. **GH Action pinning preserves Dependabot via trailing comments** — `actions/checkout@<40-char-sha>  # v4` lets Dependabot still propose major-version bumps even though the version ref is the SHA. No loss of automated upkeep.

4. **SonarCloud Auto Analysis cannot ingest LCOV** — the v0.1.2 release reported 0% coverage because Auto Analysis only sees source. Switching to CI-based scanning (`SonarSource/sonarqube-scan-action@v6`, NOT v5 due to GHSA-5xq9-5g24-4g6f) unlocks the coverage metric. The cost is the user must disable Auto Analysis at `sonarcloud.io/project/analysis_method` before the next push — Sonar rejects CI scans while Auto is active.

5. **`v6` not `v5`** — `sonarqube-scan-action@v5` has GHSA-5xq9-5g24-4g6f (argument-injection advisory). The previous `ci.yml` comment block warned about this; we honored the warning when re-enabling.

6. **Pool-workers requires istanbul, not v8** — `@cloudflare/vitest-pool-workers` 0.16 only supports istanbul for coverage (v8 is blocked inside workerd). Adding `@vitest/coverage-istanbul ^4.1.6` was necessary for two workers that hadn't needed it before.

7. **`S6440` classification varies** — SonarCloud's v6 CI scanner classifies the Playwright `use` hook fixture as a `BUG` (severity MAJOR), while Auto Analysis had it as a HOTSPOT. The same `S6440` rule applies; the user marked it as False Positive in UI to flip Reliability C→A.

8. **The 7-commits-not-1 decision paid off** — keeping each security finding as its own conventional commit made the v0.1.3 CHANGELOG 1:1 with the git history, and any future revert is surgical instead of touching the whole release.

---

## 7. Outstanding / deferred items

| Item                              | Status                       | Note                                                                 |
| --------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Multi-provider webhook normaliser | Deferred to v0.2             | Stripe-only in v0.1.x (plan A27)                                     |
| Pre-existing 194 code smells      | Not blocking                 | Maintainability rating remained A; smells are mostly TS style triage |
| `agent-temp/` cleanup             | Done this session (4.1M → 0) | Gitignored; safe to wipe between sessions                            |

No follow-up tasks pending. Workspace is ready for the next initiative.

---

## 8. Pointers for the next session

- Plan file is archived at `instruction/archive/001-phase-7-security-hardening-v0.1.3/plan.md` — that file contains the full Phases 1–7 history, lessons learned (L1–L7), and amendments (A1–A29). Future plans can reference it via `[[archived-plan]]` shorthand.
- The `instruction/security-review.md` audit is at `86e7acb` on `main` and remains the authoritative pre-v0.1.3 snapshot.
- README badges + Release page already reflect v0.1.3; no manual badge swap required.
- For v0.2: candidate work includes multi-provider webhook normaliser, real-payment integration, admin dashboard. All explicitly deferred per `instruction.md` §9.
