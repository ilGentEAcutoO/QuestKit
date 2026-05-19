# Requirements

> Captured: 2026-05-19

## Source

Full project specification: [`instruction/instruction.md`](../instruction.md) — verbatim user input,
the authoritative spec for QuestKit. All planning derives from that file.

## User reminders & overrides captured during planning session

- **2026-05-19** — User invoked `/workflow-plan @instruction/instruction.md` with the explicit
  reminder: **"อย่าลืมว่า repo เป็น public นะ"** ("Don't forget the repo is public")
  → Baked into the plan as a cross-cutting non-functional requirement: every commit, file,
  binding name, and deploy step assumes a hostile reader (forker, recruiter, attacker).

- **2026-05-19** — Q&A answers:
  - **CF naming convention** → strict skill-enforced `[project]-[service]-[purpose]`. This
    OVERRIDES the names in `instruction.md §1, §6, §7, §8` (e.g. `questkit-api` becomes
    `questkit-worker-api`).
  - **Domain** → `questkit.jairukchan.com` (custom domain user owns via `jairukchan.com`).
    Use subdomains: `questkit.jairukchan.com` (demo), `api.questkit.jairukchan.com`,
    `docs.questkit.jairukchan.com`, `play.questkit.jairukchan.com`,
    `webhook.questkit.jairukchan.com`.
  - **GitHub repo** → already exists at `github.com/ilGentEAcutoO/QuestKit` with `origin` set.
    No commits yet. First push lands the Phase 1 scaffold.
  - **Plan scope** → All 6 phases planned upfront (~33 tasks).

- **2026-05-19** — User override: **"ใช้ได้แต่ worker นะั ห้ามใช้ pages"** ("Workers only,
  no Pages")
  → OVERRIDES `instruction.md §1, §2, §6, §7, §11` Cloudflare Pages references.
  → `apps/demo`, `apps/docs`, `apps/playground` each ship as their own **Cloudflare Worker
  with the `[assets]` binding** (Workers Static Assets, GA since 2024). Pages bindings,
  `wrangler pages deploy`, and `.github/workflows/deploy-pages.yml` are removed from
  the plan. CI/CD uses a single `deploy-workers.yml` for all 6 Workers.
  → Naming: `questkit-worker-demo`, `questkit-worker-docs`, `questkit-worker-play` replace
  the `questkit-pages-*` names from the earlier Q&A.

- **2026-05-19 22:30** — User invoked `/workflow-plan add phase 4 to plan ฉันจะเริ่ม sessions ใหม่ รวมถึง phase ที่เหลือทั้งหมดด้วยนะ`
  ("Add Phase 4 to plan. I'll start new sessions, including all remaining phases.")
  → Phase 3 shipped; user will resume Phases 4–6 in fresh sessions.
  → **Plan addendum §10** added to `plan.md` capturing Phase 3 lessons + Phase 4–6 tech
  validation. User-approved during the Q&A: (a) lessons live in `plan.md §10` (single
  source of truth) over a separate handoff.md or ADR; (b) the testing-architecture
  decision is _also_ captured as ADR-006 via new TASK-032b — permanent record for
  future contributors.
  → **Plan amendment A22**: SonarSource archived `sonarcloud-github-action` on 2025-10-22.
  TASK-029 swapped to `SonarSource/sonarqube-scan-action@v5` (drop-in successor).
  → Phase 4–6 todos.md entries enriched with Phase 3 lessons (TASK-022 queue test
  pattern, TASK-026 Tailwind+Infima specificity, TASK-029 action rename). Existing
  tasks otherwise unchanged.

## Top-level success criteria (from spec §13)

1. A recruiter lands on the README and within 30 seconds wants to click the demo link.
2. A senior engineer can drill into any architecture decision and find a documented rationale
   in `docs/decisions/`.
3. A stranger can fork the repo and deploy their own working copy in 10 minutes using
   `docs/SELF_HOSTING.md`.
4. The repo is something Bosso would proudly link in his LinkedIn header.

## Hard constraints (from spec §1, §9, §11)

- Cloudflare-only at runtime — no Vercel, Supabase, Neon, Auth0, etc.
- React 18 (not Vue, deliberately — JD requirement).
- Jest (not Vitest for packages — JD requirement). Vitest only for Worker tests.
- Postman + Newman for API tests (JD requirement).
- SonarCloud for static analysis (JD requirement).
- Docusaurus 3 for docs (JD requirement).
- Zero secrets in git history, ever.
- 6-day build (Phases 1–6, one phase per "day").
