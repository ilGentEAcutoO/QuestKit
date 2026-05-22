# Changelog

All notable changes to QuestKit are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.22] — 2026-05-22 — F14 (ACTUAL root cause — null-loader stripped CSS modules)

v0.1.21 also didn't fix it. swcJsLoader wasn't the cause either —
disabling it didn't restore CSS module classes to the SSR HTML.

The ACTUAL ACTUAL root cause: `apps/docs/src/plugins/tailwind-plugin.js:103-106`
had a webpack rule routing ALL `.css` files (including `.module.css`)
through `null-loader` on the server bundle. The intent was to skip
3rd-party CSS at SSG time. But `null-loader` REPLACES css-loader,
which is what runs CSS module class-name transformation. So when
React components did `import styles from './styles.module.css';`,
the `styles` object on the server was `{}`, every
`<div className={styles.docMainContainer}>` rendered as
`<div className="">`, and Docusaurus's flex layout grid silently
disappeared from the SSR HTML. The browser-side bundle still had
the hashed class rules (`.docMainContainer_Um4l { display: flex }`)
but nothing in the SSR DOM matched them.

### Fixed

- **`apps/docs/src/plugins/tailwind-plugin.js` — added
  `exclude: /\.module\.css$/` to the SSR null-loader rule
  (F14).** CSS modules now go through css-loader's name
  transformation (producing `styles.docMainContainer =
'docMainContainer_Um4l'`); only non-module global CSS (Infima
  default.css, etc.) still gets null-loaded server-side — which
  IS what the original comment said the intent was.

  Local build verification:

  ```
  class="docRoot_eyM7"
  class="theme-doc-sidebar-container docSidebarContainer_nCiQ"
  class="docMainContainer_Um4l"
  ```

  Three hashed CSS module classes that were MISSING in v0.1.17-21.

### The 6-iteration story

For the record, in case future me (or anyone) chases a similar bug:

- v0.1.17 (F9-a Prism `jsonc`): real bug, fixed. Independent of layout.
- v0.1.17 (F9-b README CTA): UX win, unrelated.
- v0.1.18 (F10 Tailwind `important`): cleanup, not the cause.
- v0.1.19 (F11 Tailwind preflight in docs custom.css): cleanup,
  not the cause.
- v0.1.20 (F12 react theme.css transitive Tailwind): cleanup,
  not the cause.
- v0.1.21 (F13 swcJsLoader): cleanup, not the cause.
- v0.1.22 (F14 null-loader excluding CSS modules): THE actual fix.

The first 4 cleanups (F10-13) are all legitimately worth keeping —
each one removes a small papercut. But none of them addressed the
real issue. The actual issue was 1 character: change `test:` to
`test: + exclude:` in the SSR webpack rule.

### Lesson worth its own ADR

**When SSR HTML lacks expected class names but the CSS bundle has
the matching rules, the culprit is in the SSR-side build
(loaders, plugins, transformers), not in CSS.** Specifically:

- Compare local `pnpm build` output HTML vs CSS bundle
- grep for the missing class name across `apps/*/src/`
- Trace the webpack/rspack module rules for `.css` patterns

The diagnostic took 5 wrong attempts because the surface symptom
(layout broken) suggested CSS. But the SSR HTML lacking class
names was a JS/webpack symptom from the start.

### Verification

- Local docs build: HTML contains `.docRoot_*`, `.docMainContainer_*`,
  `.docSidebarContainer_*` hashed classes ✅
- Pending prod re-verify after deploy

### Cross-references

- TASK-022 in `instruction/work/todos.md`
- Continues from v0.1.21 (commit `3bcd381`)
- F9 / F10 / F11 / F12 / F13 / F14 all address the same user
  report ("docs site UI เละเทะมาก"); F14 is the actual root cause.

## [0.1.21] — 2026-05-22 — F13 (REAL root cause — swcJsLoader stripped CSS modules)

v0.1.17/18/19/20 were all WRONG diagnoses. Each shipped successfully
(CSS hash changed each time) but the layout stayed broken because
the CSS-side fixes were addressing symptoms, not the cause.

The ACTUAL root cause: `apps/docs/docusaurus.config.ts` had
`future: { faster: { swcJsLoader: true } }` (added in TASK-026c).
The swc JS loader DROPPED CSS module class-name transformation.
Symptom: CSS bundle had `.docMainContainer_UUXy { display: flex }`
etc. (Docusaurus's CSS module classes), but rendered SSR HTML had
NONE of those classes on its divs. The flex rule existed, the DOM
existed, but no element matched → no flex → sidebar (1905px
display:block) stacked on top of main wrapper (1905px display:block).

### Fixed

- **`apps/docs/docusaurus.config.ts` — disabled
  `future.faster.swcJsLoader` (F13).** Back to Docusaurus default
  JS loader (babel via webpack) which correctly runs css-loader's
  CSS module name transformation. Sidebar + main wrapper now
  receive their `.docMainContainer_*` / `.docRoot_*` hashed
  classes and the flex layout fires.

  If the original TASK-026c webpack-CJS parser bug returns,
  address it with a targeted fix (configurePostCss + webpack
  alias) rather than reverting to swcJsLoader.

### What v0.1.17 → v0.1.20 actually did (for the record)

- v0.1.17 (F9-a Prism): valid fix — `Cannot find module './prism-jsonc'`
  was a real JS bundle init crash. Wasn't the layout issue but real.
- v0.1.17 (F9-b README Demo CTA): valid UX win, unrelated to docs.
- v0.1.18 (F10 drop Tailwind important): made utilities non-important.
  Not the cause but worth keeping (cleaner).
- v0.1.19 (F11 skip Tailwind preflight in docs custom.css): trade-off
  worth keeping (avoids preflight clobbering Infima). Not the cause.
- v0.1.20 (F12 selective import in react theme.css): trade-off
  worth keeping (cleaner dep graph). Not the cause.
- v0.1.21 (F13 disable swcJsLoader): THE actual fix.

### Lesson worth its own ADR

CSS-side fixes (v0.1.18-20) were chasing symptoms. The actual issue
was JS toolchain config that stripped a CSS module transformation.
**When CSS bundle has the rules but DOM doesn't have the matching
classes**, the issue is in the JS/JSX pipeline (loader/transformer),
not in CSS itself. grep for class names in rendered HTML BEFORE
debugging CSS overrides.

### Verification

- `pnpm typecheck` 14/14 packages clean (no test changes)
- Pending docs prod re-verify

### Cross-references

- TASK-021 in `instruction/work/todos.md`
- Continues from v0.1.20 (commit `60aa3ab`)
- F9 / F10 / F11 / F12 / F13 all address the same user report
  ("docs site UI เละเทะมาก"); F13 is the actual root cause.

## [0.1.20] — 2026-05-22 — F12 (root cause — react theme.css transitive Tailwind import)

v0.1.17 → v0.1.18 → v0.1.19 were three CONSECUTIVE attempts to fix
the docs site layout, and ALL THREE failed. CSS hash changed each
time (proving the build was rebuilt + deployed), but the sidebar
stayed at 1905px display:block and the layout stayed a single tall
column.

The reason all three docs-side fixes failed: **`packages/react/src/styles/theme.css:23`
had `@import 'tailwindcss';`** (the bulk form, includes preflight),
and `apps/docs/src/css/custom.css:22` imported `@questkit/react/styles.css`.
So no matter what we did in custom.css, the transitive import from
the theme package pulled the full Tailwind back in, preflight and
all. The docs's selective import was undone two layers deep in the
CSS dependency graph.

### Fixed

- **`packages/react/src/styles/theme.css` — use selective imports
  (F12).** Was: `@import 'tailwindcss';` (bulk = preflight + theme
  - utilities). Now: `@import 'tailwindcss/theme' layer(theme);` +
    `@import 'tailwindcss/utilities' layer(utilities);` — same
    pattern as v0.1.19 docs custom.css. Drops the destructive
    preflight (`* { margin: 0; padding: 0 }`) that was clobbering
    downstream consumers' layouts. Added a docblock paragraph
    explaining the v0.1.17–v0.1.20 incident so future maintainers
    don't re-introduce the bulk import.
- Demo unaffected: `apps/demo/src/styles.css:9` has its OWN
  `@import 'tailwindcss';` so it still gets preflight independently.
- Embed: `packages/embed/src/styles.ts` already had a comment
  acknowledging this concern — no change needed.

### Verification

- `@questkit/react`: 156 tests pass (no test changes)
- `@questkit/demo`: 14 tests pass (unaffected, has own Tailwind import)
- Typecheck + lint clean
- Pending docs prod re-verify (load
  https://docs.questkit.jairukchan.com/docs/ → confirm sidebar
  narrow + main wide 2-column layout)

### The 3-iteration lesson

Each docs-side fix worked on its own merits but was rendered moot by
the transitive import. The lesson: **when a CSS issue persists across
"fixes" but the bundle hash IS changing**, look upstream in the
import graph, not at the surface-level import. The docs site
imported a styles.css from a package that itself imported the
problematic style. Subtle.

### Cross-references

- TASK-020 in `instruction/work/todos.md`
- Continues from v0.1.19 (commit `267ee3e`)
- F9 / F10 / F11 / F12 are all attempts to fix the SAME user
  report ("docs site UI เละเทะมาก"); F12 is the actual root cause.

## [0.1.19] — 2026-05-22 — F11 (docs layout — skip Tailwind preflight)

v0.1.18 dropped the `important` flag from the Tailwind import but the
layout STAYED broken: sidebar (1905px) still stacked on top of main
(1905px), display:block on both, no flex split. CSS hash DID change
(`effaa4b5` → `6de76a20`), so the build was rebuilt and the fix DID
ship — but it wasn't enough. The root cause was deeper: Tailwind v4
preflight resets `* { margin: 0; padding: 0; box-sizing: border-box }`
on every element, regardless of `important` flag, clobbering the
spacing Docusaurus's `.theme-doc-root` flex layout relies on.

### Fixed

- **`apps/docs/src/css/custom.css` — skip Tailwind preflight (F11).**
  Was: `@import 'tailwindcss';` (= preflight + theme + utilities).
  Now: `@import 'tailwindcss/theme' layer(theme);` +
  `@import 'tailwindcss/utilities' layer(utilities);` — explicitly
  imports theme + utilities only. Docusaurus's Infima provides its
  own reset/normalize, so Tailwind's preflight was redundant and
  destructive. Tailwind utilities (bg-blue-500, p-4, etc.) still
  work for MDX examples; only the @reset layer is omitted.

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean
- Lead release pipeline pending docs re-verify (load
  https://docs.questkit.jairukchan.com/docs/ → sidebar narrow on
  left, main wide on right, navbar uncluttered, hamburger menu
  on mobile widths)

### Cross-references

- TASK-019 in `instruction/work/todos.md`
- Continues from v0.1.18 (commit `fd27387`)

## [0.1.18] — 2026-05-22 — F10 (docs site layout fix — drop Tailwind important)

User report: docs site UI still broken after v0.1.17. Console errors
0, but sidebar (1905px) was stacking on top of main content (1905px)
in a single tall column — no left-rail / right-content split. Also
navbar looked "รก" (cluttered). Both same root cause: F10.

Root cause: `apps/docs/src/css/custom.css` had
`@import 'tailwindcss' important;` to make Tailwind utilities win
against Infima compound selectors in MDX examples. But the
`important` flag promotes EVERY utility (including ones that
Docusaurus's layout containers `.theme-doc-root`,
`.docMainContainer_*`, `.docPage_*` happened to also use) to
`!important`. Tailwind's `display: block !important` clobbered
Docusaurus's `display: flex` on the layout wrappers, the sidebar
flexbox grid collapsed to two stacked `display: block` divs, and
chrome elements like the navbar dual-logo (light/dark variants)
showed simultaneously instead of being toggled by CSS.

### Fixed

- **`apps/docs/src/css/custom.css` — dropped `important` flag from
  `@import 'tailwindcss';` (F10).** Trade-off accepted: MDX
  examples that use Tailwind utility classes may be overridden by
  Infima compound selectors. Authors who need Tailwind to win can
  use the `!` per-class modifier (`bg-blue-500!`) — Tailwind v4
  supports this and it's cleaner than the global flag because it
  only escalates where actually needed, not everywhere. Updated
  the file's docblock to record the F10 incident + workaround so
  future maintainers don't re-add the `important` flag without
  understanding the cost.

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean
- `pnpm test` 11/11 packages, 0 failures (CSS fix only — no test changes)
- Lead release pipeline pending docs re-verify

### Cross-references

- TASK-019 in `instruction/work/todos.md`
- Continues from v0.1.17 (commit `72e45d1`)

## [0.1.17] — 2026-05-22 — F9 (docs site CSS fix + README Demo CTA)

User report: `https://docs.questkit.jairukchan.com/docs/` UI "เละเทะมาก"
(completely unstyled raw markup — 1996-era HTML look). Root cause:
`apps/docs/docusaurus.config.ts` had `"jsonc"` in `additionalLanguages`
but Prism doesn't ship a `prism-jsonc` language module. Docusaurus's
runtime dynamic require threw `Cannot find module './prism-jsonc'`,
the JS bundle initialization crashed, CSS injection never ran, React
never hydrated → page rendered as pure unstyled HTML. Footer dark
theme rendered because that's static CSS, but everything else was
broken.

Also: README.md had the Demo link buried in the middle of the link
row. User wanted it surfaced as the first prominent CTA.

### Fixed

- **`apps/docs/docusaurus.config.ts` — removed `"jsonc"` from
  `additionalLanguages` (F9-a).** ```jsonc code blocks now degrade
  to plain text (no syntax highlighting). If JSONC highlighting is
  needed later, add a custom Prism plugin that aliases jsonc to
  json + a comment grammar — don't add jsonc back to this list
  without verifying the module exists. Added a defensive comment at
  the site explaining the crash chain so future maintainers don't
  re-introduce it.
- **`README.md` — Demo now leads (F9-b).** Restructured top of file:
  big ▶ Try the Live Demo badge button → GIF → quick links row →
  tagline → CI/quality badges. Was: title → tagline → badges →
  GIF → tiny "Live Demo" link buried in a row of 4 links → status
  note. Now the Demo is the FIRST clickable element, sized for
  visual weight.

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean
- `pnpm test` 11/11 packages, 0 failures (no test changes — fixes
  are config + Markdown only)
- Lead release pipeline pending docs site re-verify (load
  https://docs.questkit.jairukchan.com/docs/ → confirm CSS loaded
  - no `Cannot find module './prism-jsonc'` console error)

### Cross-references

- TASK-018 in `instruction/work/todos.md`
- Continues from v0.1.16 (commit `99027cb`)

## [0.1.16] — 2026-05-22 — F8-a (DOCUMENTARY pill for discoverability)

User report (post-v0.1.15): clicked Watch on /streaming videos, but
"Documentaries today" widget stayed 0/3. Console log showed
`mis_stream_longform_week` (Deep Diver) progressing — but no
`mis_stream_documentary_3` events. Diagnosis: user clicked
non-documentary videos (drama/action/comedy/sport). Curious Mind's
server rule filter is `{genre: {eq: "documentary"}}` — only doc
clicks count. Even after F5-c renamed widget to "Documentaries
today" and F7-b added a 3rd doc (Arctic Tales), the genre subtext
("documentary · 55 min") in each card was easy to miss and users
kept clicking non-docs.

### Fixed

- **`apps/demo/src/routes/streaming.tsx` — added a "📺 DOCUMENTARY"
  pill next to each documentary video title in the Library
  (F8-a).** Teal background, white bold uppercase, tracking-wide —
  visually distinct from indigo CTA buttons, amber coin rewards,
  and red error states. Only renders when `video.genre ===
"documentary"` (3 cards: Planet Earth III, Blue Worlds, Arctic
  Tales). `flex-wrap` on the title-pill wrapper so on narrow
  viewports the pill wraps below the title instead of overflowing
  the card. Genre subtext kept verbatim (still useful context;
  pill is additional emphasis). 📺 is `aria-hidden`; visible
  "DOCUMENTARY" text is the a11y surface.

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean
- `pnpm test` 11/11 packages, 0 failures (demo 14/14 unchanged,
  react 156/0 unchanged, worker-api 216/0/1-skip unchanged)
- Pill purely visual — no behaviour or event change, so no new
  test specs needed

### Cross-references

- TASK-017 in `instruction/work/todos.md`
- Continues from v0.1.15 (commit `52ba1fe`)

## [0.1.15] — 2026-05-22 — F7 batch (honest per-spin toast + 3rd documentary)

User report (post-v0.1.14): per-spin/scratch toast text said
"Badge: lucky_spinner" / "Badge: scratch_master" but no badge was
actually granted until the user reached the mission target + clicked
Claim. Misleading copy. Also: Library has only 2 unique documentaries
(`v_doc_planet`, `v_doc_oceans`) but Curious Mind needs 3 documentary
watches — unreachable with unique clicks.

### Fixed

- **`apps/demo/src/components/DemoToastHost.tsx` — new
  `kind:"progress"` toast variant (F7-a).** `DemoToastInput =
Reward | DemoToastError | DemoToastProgress` where
  `DemoToastProgress = {kind:"progress", missionId, label}`. Renders
  with a distinct icon + neutral chip styling (not the warm gold of
  the badge variant) so users can tell at a glance that progress
  was recorded vs an actual badge being granted.
- **`apps/demo/src/routes/minigames.tsx` SpinWheel onSpin + ScratchCard
  onReveal now fire `kind:"progress"` toasts (F7-a).** Replaces the
  prior `showToast({kind:"badge", badgeId:"lucky_spinner|scratch_master"})`
  which visually mimicked the actual claim-success badge toast. The
  fireEvent payload is unchanged — server-side mission still
  increments correctly. The actual badge-grant toast still fires
  from `useMissionClaim` on claim success — that's correct and
  unchanged.
- **`apps/demo/src/routes/streaming.tsx` Library now has 3 unique
  documentaries (F7-b).** Added a third documentary entry so
  Curious Mind (target 3 documentary watches) is reachable with 3
  unique clicks rather than requiring the user to repeat a video.
  Updated `apps/demo/e2e/streaming.spec.ts` to reflect the new
  Library count.

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean
- `pnpm test` 500+ tests, 0 failures:
  - `@questkit/demo`: 14 tests (was 11, +3 from F7-a DemoToastHost
    progress variant specs)
  - other packages unchanged

### Cross-references

- TASK-016 in `instruction/work/todos.md` for full evidence
- Continues from v0.1.14 (commit `82caa93`)

## [0.1.14] — 2026-05-22 — F6 fix (ScratchCard preventDefault + no-select)

User report (post-v0.1.13 thorough test): "scratch card ก็ scratch ไม่ได้
เพราะรูปข้างหลังมันติดเมาส์มาด้วย" ("can't scratch because the image/text
behind drags with mouse"). Real bug — missed in v0.1.13 prod verify
because the test used synthetic `dispatchEvent` pointer events which
produce UNTRUSTED events whose `defaultPrevented` is a no-op against
browser default behaviour. Real users (trusted events) hit the bug.

### Fixed

- **`packages/react/src/components/ScratchCard/index.tsx` —
  `handlePointerDown` and `handlePointerMove` now call
  `e.preventDefault()` as their FIRST action (F6).** Before this,
  browser default behaviour (text selection on the underlying prize
  text spans, possible HTML5 drag-and-drop on `<img>` prizes) ran
  concurrently with the scratch logic and visually "dragged" the
  prize content with the cursor. preventDefault before the
  `revealedRef.current` early-return so re-clicks on a revealed card
  also suppress browser default (matches user expectation).
- **canvas + `.qk-scratchcard__prize` wrapper now carry
  `userSelect: "none"` (F6).** Belt-and-suspenders for the
  preventDefault: even if a future refactor drops the handler
  preventDefault, the canvas + prize text can't be selected anyway.
- **`apps/demo/src/routes/minigames.tsx` prize wrapper also carries
  `userSelect: "none"` (F6).** Consumer-level defence-in-depth for
  the demo's specific prize JSX.

### Why this slipped through

Lead's v0.1.13 prod verify dispatched pointer events via
`canvas.dispatchEvent(new PointerEvent(...))` and saw "Prize revealed"
text appear — concluded scratch worked. But synthetic events bypass
browser default action entirely; the bug exists only under trusted
input. Future scratch/drag tests must use real Playwright pointer
APIs (`page.mouse.move/down/up`) or assert `preventDefault` is wired,
not rely on observing the synthetic-event outcome.

### Other "v0.1.13 bugs" — explained, not fixed

Same user report flagged two more concerns that turned out to be
correct-per-design behaviours rather than bugs:

- **"Spin wheel ได้ Sparkle แต่ badge ไม่ขึ้น"** — Lucky Spinner
  mission requires 5 spins + claim. One spin = 1/5 progress
  visible on the in-place card (F5-a). UX is working as specified.
- **"Curious Mind ค้าง 1/3"** — widget mirrors
  `mis_stream_documentary_3` (documentaries-only filter). F5-c
  renamed the label to "Documentaries today" to make this
  explicit. Clicking drama/action/comedy/sport advances Daily
  Watcher (1/1 target) and Deep Diver (10/week, post-F4-a) but
  NOT Curious Mind — by design.

These are Phase 10 candidates if more discoverability work is
warranted (e.g., a "Mission breakdown by event" toast or a
filter pill row above the Library).

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean (modulo pre-existing Node ESM warning)
- `pnpm test` 500+ tests, 0 failures, 1 pre-existing skip:
  - `@questkit/react`: 156 tests (was 152, +4 from F6 ScratchCard regression)
  - `@questkit/demo`: 11 tests (unchanged)
  - `@questkit/worker-api`: 216 tests (unchanged)
- Lead release pipeline pending Playwright prod re-verify

### Cross-references

- TASK-015 in `instruction/work/todos.md` for full evidence
- Continues from v0.1.13 (commit `3501cb0`)

## [0.1.13] — 2026-05-22 — F5 UX batch (in-place minigame cards + multi-currency balance + Documentaries label)

User thorough re-test of v0.1.12 surfaced three UX gaps that obscured
the working server-side flow. None are functional bugs — server-side
mission progression, claim, badge granting, SSE delivery all verified
working in v0.1.12 prod-verify — but the demo UX hid the working
plumbing behind page navigation, label ambiguity, and a single-currency
balance display.

### Fixed

- **`apps/demo/src/routes/minigames.tsx` — Lucky Spinner + Scratch
  Master mission cards now render IN-PLACE on /minigames (F5-a).**
  Previously the mission cards only existed in the global "Active
  missions" list on /ecommerce, so users who spun 5 times or
  scratched 3 times on /minigames had no Claim button visible and
  thought the badge was broken. Server-side mission progression was
  already correct (verified via Playwright). Added a new
  "Mini-game missions" section between the widgets and the
  "How the mini-games connect" info block: filters
  `useMissions()` to `["mis_lucky_spinner", "mis_scratch_master"]`,
  renders each as a `MissionCard` with `useMissionClaim` (preserves
  v0.1.9 F1 backstop — toast on 409 + refetch convergence). Users
  can now spin → claim → see badge without leaving /minigames.

- **`apps/demo/src/components/Layout.tsx` — balance header shows all
  three demo currencies (coin, gem, point) instead of just coin
  (F5-b).** Variety Pack mission rewards `+5 gem` but the
  single-currency header rendered only coin, so users had no way to
  see their gem balance anywhere in the UI. New `BalanceMulti`
  inline component renders coin with the existing `CoinIcon` brand
  treatment (preserving v0.1.0–v0.1.12 visual identity) plus gem
  and point as compact glyph chips. All three always render — zero
  balance still appears so users discover the currency vocabulary
  before earning. `useBalance()` (no-arg overload) returns the full
  `Balance[]` array via SSE-driven upsert. ARIA label includes all
  three amounts. Demo-only inline JSX — `packages/react/CoinBalance`
  was NOT modified (its `currency` prop is required by API
  contract). +3 Layout test specs covering zero-backfill, server
  amounts, and ARIA shape.

- **`apps/demo/src/routes/streaming.tsx` — "Watched today" widget
  re-labeled to "Documentaries today" (F5-c).** The widget mirrors
  `mis_stream_documentary_3` (per TASK-002 Phase 9), so it only
  counts documentary watches — clicking drama/action/comedy/sport
  videos did NOT advance it. User experience: "watch แล้ว ไม่ขึ้น
  ใน watched today บางครั้งบางอัน" ("only sometimes"). Pure copy
  change: heading + section aria-label + counter aria-label all
  reworded to make the filter explicit. Layout untouched (single
  line, same width budget). `apps/demo/e2e/claim-flow.spec.ts`
  regex updated to match new copy.

### Why this matters

v0.1.9-12 closed F1-F4 (silent claim failure → multi-tenant race →
double-bump → SpinWheel/Deep Diver/mission.completed). v0.1.13
closes the UX layer that was hiding the working plumbing. With F5
landed, a user can: spin 5 times on /minigames → see Claim button
on the same page → click → badge appears + gem balance updates in
header.

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean (modulo pre-existing Node ESM warning)
- `pnpm test` 500+ tests, 0 failures, 1 pre-existing skip:
  - `@questkit/react`: 152 tests (unchanged from v0.1.12)
  - `@questkit/demo`: 11 tests (was 8, +3 from F5-b Layout multi-currency)
  - `@questkit/worker-api`: 216 tests (unchanged from v0.1.12)
- Demo gates: minigames.tsx + Layout.tsx + streaming.tsx all
  typecheck + lint clean per-package
- Lead release pipeline pending Playwright prod re-verify

### Cross-references

- TASK-014 in `instruction/work/todos.md` for full evidence + per-agent reports
- Continues from v0.1.12 (commit `aa8df37`)

## [0.1.12] — 2026-05-22 — F4 batch (SpinWheel visual + mission.completed dedup + Deep Diver field)

User prod inspection of v0.1.11 surfaced three pre-existing UX defects
unrelated to the F1+F2+F3 chain — none caused by v0.1.9-11 changes, all
present since Phase 7-8 but never reported until users started trusting
the demo enough to lean on it.

### Fixed

- **`packages/react/src/components/SpinWheel/index.tsx` — visual pointer
  now lands on the announced winning slice (F4-c).** Root cause: the
  slice-draw loop started at `-90°` (top of wheel) but the
  landing-rotation math omitted that offset, so every spin ended ~1.5
  slices clockwise of the announced winner. Extracted
  `DRAW_OFFSET_DEG` and `POINTER_ANGLE_DEG` constants used by BOTH the
  draw loop and the landing math; the formula is now
  `targetRotation = baseSpins * 360 + (POINTER_ANGLE_DEG - (DRAW_OFFSET_DEG + winnerIdx * sliceAngleDeg + sliceAngleDeg / 2))` normalized
  to a positive degree. Public API unchanged. +7 Jest specs (one
  per `winnerIdx 0..5` plus an announce-vs-visual replication of the
  user's "Streak +1!" evidence) pin the contract.
- **`workers/api/src/services/ingest.ts` — `mission.completed` SSE
  event no longer re-fires on subsequent matching events for an
  already-completed mission (F4-b).** Root cause: the rule engine
  intentionally keeps bumping `currentCount` for already-completed
  rows for analytics accuracy, but the broadcast layer in
  `tryBroadcastProgress` was unconditionally re-emitting
  `mission.completed` per bump (Daily Watcher with target=1 fired
  `mission.completed` 6 times for 6 video.watched events). Fix
  (Option B — emit-layer): capture `priorStatusByMissionId` before
  `evaluateEvent`, then `continue` past the SSE emit when both prior
  AND new status are terminal. Rule engine semantics + D1 row updates
  unchanged. +2 regression tests in
  `workers/api/test/events.route.test.ts` (one negative — no
  duplicate frame, one positive control — genuine active→completed
  transition still broadcasts).
- **`workers/api/migrations/0005_fix_deep_diver_rule.sql` (new) —
  Deep Diver mission now actually progresses on long-form videos
  (F4-a).** Root cause: the rule criteria filter was
  `{durationMin: {gte: 20}}` (minutes) but the demo's `video.watched`
  event payload sends `duration_sec` (seconds). Filter is strictly
  literal payload-property lookup (confirmed in
  `workers/api/src/rules/filter.ts`) — no aliases — so the field
  mismatch silently rejected every event. Migration `UPDATE`s
  `mis_stream_longform_week.criteria_json` to use
  `{duration_sec: {gte: 1200}}` (1200s = 20min). +5 evaluator tests
  in `workers/api/src/rules/evaluator.test.ts` covering boundary,
  match, no-match, missing-field, and legacy-field-ignored cases.

### Why this matters

v0.1.9-11 closed the F1+F2+F3 chain (silent claim failure → demo error
toast → per-browser user → no double-bump). With those baseline UX
guarantees, users finally exercised the demo end-to-end and surfaced
defects that had been latent. v0.1.12 closes the next layer (visual
sync, redundant SSE emit, rule data correctness). Phase 9 archive now
truly clean.

### Verification

- `pnpm typecheck` 14/14 packages clean
- `pnpm lint` 10/10 packages clean (modulo pre-existing Node ESM warning)
- `pnpm test` 500+ tests, 0 failures, 1 pre-existing skip:
  - `@questkit/react`: 152 tests (was 145, +7 from F4-c)
  - `@questkit/worker-api`: 216 tests (was 209, +5 from F4-a, +2 from F4-b)
  - `@questkit/demo`, `@questkit/core`, `@questkit/embed`: unchanged

### Cross-references

- TASK-013 in `instruction/work/todos.md` for full evidence trail
- `agent-temp/spin-wheel-mismatch-prize-vs-pointer.png` — pre-fix screenshot
- Continues from v0.1.11 (commit `d6e8e09`)

## [0.1.11] — 2026-05-22 — F3 fix + browser logging

Playwright prod-verify of v0.1.10 (per-browser demo user) confirmed F1 +
F2 were truly fixed but surfaced a third defect (F3): the
`packages/react/src/hooks/useMissions.ts` hook ran TWO update paths per
event. The SSE handler applied a monotonic `Math.max` merge on
`currentCount` (correct on its own), AND the
`client.onFireEventSuccess` handler added an optimistic `+1` from the
existing count (also correct on its own). In the normal happy path BOTH
fired for the same event — POST `/v1/events` returned with the mission
acknowledged AND the SSE_HUB DO delivered `mission.progress` for the
same event — and the display advanced by 2 while the server-authoritative
count advanced by 1. Eventually the display reached `targetCount` while
the server stayed below, and `POST /v1/missions/:id/claim` returned 409
`claim_not_ready`. The v0.1.9 demo error toast caught the 409 and
refetched, so the failure was recoverable, but the UX cost was a
confusing "Not ready yet" toast on what looked like a complete mission.

### Fixed

- **`packages/react/src/hooks/useMissions.ts` — drop the optimistic
  `+1` path; SSE is now the sole source of progress updates.** The
  `useEffect` that subscribed to `client.onFireEventSuccess` and bumped
  `currentCount + 1` (clamped at `targetCount`) is deleted. The SSE
  handler is unchanged in logic — same monotonic-merge for
  `mission.progress`, same unconditional-overwrite for
  `mission.completed` / `mission.claimed`. The hook's top docblock is
  rewritten to explain why SSE is now sole-truth and to document the
  trade-off.

### Added

- **Browser-side `console.debug` observability.** Two new log lines so
  future regressions are visible in DevTools' Verbose level (hidden by
  the default filter, so production-noise-free):
  - `packages/react/src/hooks/useMissions.ts` — `console.debug("[questkit:mission] SSE update", { missionId, type, before, after })`
    fires once per accepted SSE delivery, BEFORE the merge runs, so it's
    captured regardless of whether the merge produced a visible change.
  - `apps/demo/src/lib/useMissionClaim.ts` — `console.debug("[demo:claim] success", { missionId, reward })`
    fires on the claim-success path, after the reward toast renders. The
    existing `console.warn("[demo] claimMission failed", err)` stays in
    the catch block.

- **F3 regression tests in
  `packages/react/test/hooks/useMissions.test.tsx`.** The pre-existing
  `describe("optimistic updates from fireEvent (no SSE)")` block is
  replaced with `describe("F3 regression — no double-bump from
optimistic + SSE")`. Three load-bearing tests:
  - `1 fireEvent + 1 SSE delivery results in +1 on display (not +2)` —
    pre-v0.1.11 this assertion would have failed with `display=2`. It
    pins the F3 fix.
  - `fireEvent without SSE delivery does NOT advance the display
(optimistic path removed)` — guards against a future regression
    that re-adds the optimistic path silently.
  - `emits a console.debug log with the expected shape on each accepted
SSE delivery` — spy on `console.debug`, assert shape.
  - Plus the original monotonic-merge regression (renamed to
    `monotonic merge: SSE never lowers currentCount on mission.progress`)
    is preserved because out-of-order SSE delivery is still a real
    failure mode the merge must defend against.

### Why

- **UX trade-off:** ~50-200ms delay between POST returning and the
  counter visibly updating, since the SSE delivery now has to round-trip
  through the SSE_HUB Durable Object. Previously the optimistic `+1`
  made the update appear instant. This is acceptable because
  `useMissionClaim` (TASK-001) already refetches on claim success AND on
  409, which catches the only critical path where an SSE drop would
  matter for the end-user flow.
- **Observability cost:** zero in production — `console.debug` is below
  the default DevTools filter level, so end users see nothing. Devs flip
  to Verbose level when investigating future progress-update bugs.

### Validation

- F3 regression test pins "1 fireEvent = +1 progress, not +2" — this
  test would fail against any v0.1.10 build.
- React unit tests: GREEN (see full evidence in
  `instruction/work/todos.md` TASK-012 Progress Notes).
- Demo unit tests: GREEN.
- TypeScript + ESLint clean for both `@questkit/react` and
  `@questkit/demo`.

### Files touched

- `packages/react/src/hooks/useMissions.ts` — drop optimistic effect,
  rewrite docblock, add `console.debug` at SSE handler
- `packages/react/test/hooks/useMissions.test.tsx` — replace optimistic
  describe block with F3 regression describe block
- `apps/demo/src/lib/useMissionClaim.ts` — add `console.debug` on
  success path
- `package.json` 0.1.10 → 0.1.11
- `workers/api/src/index.ts` `/v1/health` version 0.1.10 → 0.1.11
- `CHANGELOG.md` (this entry)

### Cross-reference

- Full task spec, root-cause evidence, and sub-agent F report in
  `instruction/work/todos.md` under TASK-012. The hard evidence (1 click
  → server +1, display +2, identical event payload) lives in the F3
  section of TASK-011's progress notes.
- TASK-007 (Phase 9, "D3 optimistic counter debounce — closed as
  non-bug") was wrong about the structural impossibility of the bug. Its
  analysis correctly identified that the SDK only bumps server-confirmed
  mission ids, but missed that the same SSE-confirmed event would
  ALSO trigger the optimistic bump, producing the double-count. The
  v0.1.11 fix supersedes that verdict.

[0.1.11]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.11

## [0.1.10] — 2026-05-22

Playwright prod-verify of the v0.1.9 F1 hotfix uncovered a second,
deeper defect (F2): every visitor to `https://questkit.jairukchan.com`
was operating as the SAME hardcoded `demo_user_42` user, because the
demo's `resolveDemoUserId()` defaulted to that literal whenever no
`?user=` query param was supplied. With multiple concurrent browsers
all writing to the same server-side state, F1-style verifications were
fundamentally unreliable — the lead's "first click" on Curious Mind
jumped the counter 0 → 2/3 in a single event because another visitor
had already pushed it to 1/3 between snapshots; users reported "I
clicked the documentary 6 times and nothing happened" once the
mission hit its completion cap from someone else's clicks.

### Fixed

- **`apps/demo/src/lib/client.tsx` + new `apps/demo/src/lib/demoUserId.ts`
  — per-browser unique demo user.** `resolveDemoUserId()` extracted to
  its own module and rewritten so each browser mints a unique
  `demo_${crypto.randomUUID().slice(0, 8)}` id on first visit, persists
  it to `window.localStorage["questkit_demo_user_id"]`, and reuses it
  across subsequent visits / reloads / new tabs on the same origin.
  Precedence preserved from v0.1.9: SSR fallback → `?user=` query
  override → localStorage hit → fresh mint + LS write. Private-mode /
  disabled-storage / quota-exceeded all fall through cleanly to a
  per-tab unique id (no crash, no persistence). Re-exported from
  `client.tsx` for any consumer that needs to call it directly.

### Added

- **`apps/demo/src/lib/client.test.tsx` — Jest spec for the new
  resolver.** Four cases lock the contract: (1) localStorage hit
  returns the stored id with no fresh mint, (2) cold start mints +
  writes, (3) `?user=` query override beats localStorage, (4)
  localStorage.getItem throwing falls through to per-tab unique id
  without persisting. Each test stubs `window.location`, `crypto.randomUUID`,
  and `window.localStorage` independently — restored in `afterEach`
  so jsdom's native impl isn't poisoned.

### Why

- Without this fix, every prod F1-style verification is fundamentally
  unreliable. The v0.1.9 F1 hotfix DID fix the KV replay symmetry bug,
  but the validation walkthrough's "Curious Mind jumped 0→2/3 in one
  click" symptom looked exactly like F1's optimistic counter overshoot
  was still happening — when in reality it was a concurrent visitor's
  click landing as a server-side rule-engine increment. With per-browser
  unique ids, the next Phase 9 verification cycle can trust what it
  measures.

### Files touched

- `apps/demo/src/lib/client.tsx` — import + re-export the new resolver
- `apps/demo/src/lib/demoUserId.ts` — NEW pure module
- `apps/demo/src/lib/client.test.tsx` — NEW Jest spec (4 cases)
- `package.json` 0.1.9 → 0.1.10
- `workers/api/src/index.ts` `/v1/health` version 0.1.9 → 0.1.10
- `CHANGELOG.md` (this entry)

### Notes

- No DB migration. No worker behaviour change. The server side already
  treats every distinct `userId` as its own scope — the v0.1.10 fix
  just stops collapsing every visitor into the same scope.
- The `?user=` override stays in place because Playwright golden-path
  - manual debugging sessions still want deterministic ids. The new
    default behaviour only kicks in when no override is present.
- If a future phase wants signed-in user identity instead of an
  anonymous per-browser id, replace the localStorage default with a
  cookie / session token surfaced from `auth.ts` — the resolver shape
  stays the same.

[0.1.10]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.10

## [0.1.9] — 2026-05-21

Post-deploy walkthrough on v0.1.8 (Phase 9 TASK-009) surfaced a silent
claim failure (F1) caused by an asymmetry between the two idempotency
replay paths in `services/ingest.ts`. The fix is a one-line source
change that brings the KV replay return into parity with the existing
D1 replay return, plus a defense-in-depth toast + refetch on the demo
side so any future similar desync becomes self-healing instead of
silent.

### Fixed

- **`workers/api/src/services/ingest.ts:179` — KV replay no longer
  echoes the original `missionsUpdated`.** The D1 UNIQUE-constraint
  replay branch at line 216 already returned `missionsUpdated: []`
  for replays; the KV branch was returning the cached array
  verbatim. Replays bypass the rule engine entirely, so letting them
  claim "these missions just incremented" caused the SDK's
  `useMissions` `onFireEventSuccess` to optimistically bump the
  client mirror while D1 stayed put. The desync surfaced as a
  silent `409 claim_not_ready` when a multi-session resume user
  clicked Claim on what the UI said was a 3/3 mission.

- **`apps/demo/src/lib/useMissionClaim.ts` — toast + refetch on 409.**
  The catch block now detects `QuestKitError` with
  `claim_not_ready` (or any 409) and (a) shows an error toast so
  the user gets feedback instead of a no-op click, (b) calls
  `onClaimed?.()` to refetch missions and re-sync with
  server-authoritative state.

### Notes

- Root cause + investigation trace in
  `instruction/work/test-report.md` under "TASK-009 — Production
  walkthrough on v0.1.8" → F1 section.
- TASK-007 (D3 closed as "non-bug" during Phase 9) should be
  reopened in Phase 10 to revisit the optimistic-counter design
  more defensively if desired. This hotfix removes the trigger
  condition without restructuring that design.
- No DB migration. No breaking SDK change.

[0.1.9]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.9

## [0.1.8] — 2026-05-21

v0.1.7 fixed the prompt-parse error but the v0.1.5 observability captured
a NEW fallback reason on the next deploy:

```
[ai] fallback reason=envelope-no-strategy-matched
  model=@cf/meta/llama-3.1-8b-instruct
  fingerprint={response:object,usage:object}
```

The AI call now succeeds but the response envelope shape changed when
`response_format=json_schema` is in use: `response` is now the parsed
object directly, not a JSON-stringified payload.

### Fixed

- **`workers/api/src/services/ai.ts` — added strategy 1b
  `response-object`.** When `aiResponse.response` is a non-null,
  non-array object, treat it as the already-parsed `AiPayload` and skip
  the JSON.parse step. The three existing strategies still run in order
  so any non-`json_schema` deploy path keeps working. Fingerprint
  observability remains; if Workers AI ships a 5th envelope shape, the
  same recipe (wrangler tail → grep `[ai] fallback reason=`) identifies
  the new variant.

### Notes

- v0.1.6 → v0.1.7 → v0.1.8 walked the bisect:
  - v0.1.6: model swap (didn't fix it, but exposed the prompt error).
  - v0.1.7: prompt-parse fix (didn't fix it, but exposed the envelope drift).
  - v0.1.8: envelope strategy added — final fix.
- Total walltime for the 3-step bisect: ~30 minutes. The observability
  shipped in v0.1.5 (TASK-006) made each step a 30-second `wrangler tail`
  capture rather than blind iteration.

[0.1.8]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.8

## [0.1.7] — 2026-05-21

Follow-up to v0.1.6 — the AI model swap exposed the actual root cause via
the v0.1.5 observability:

```
[ai] fallback reason=ai-run-threw
  model=@cf/meta/llama-3.1-8b-instruct
  errName=AiError
  errMsg=9015: invalid prompt: failed to parse prompt:
    unknown variant `json_object`, expected `json_schema`
```

### Fixed

- **`workers/api/src/services/ai.ts` — `response_format` switched from
  `json_object` to `json_schema`.** Cloudflare Workers AI no longer
  accepts the deprecated `{ type: "json_object" }` shape on
  `@cf/meta/llama-3.1-8b-instruct`; the runtime returns AiError 9015 at
  prompt-parse time before the model even runs. Now sends the explicit
  schema:

  ```ts
  response_format: {
    type: "json_schema",
    json_schema: {
      type: "object",
      properties: {
        missionIds: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
      },
      required: ["missionIds", "reason"],
    },
  }
  ```

  The existing 3-strategy `normalizeAiEnvelope` stays in place — runtime
  schema enforcement is the first-line defence; the normaliser is
  belt-and-suspenders for any edge-case envelope shape. The v0.1.5
  observability log lines remain so a future regression is grep-able.

### Notes

- Diagnostic recipe in `instruction/work/test-report.md` confirmed for
  the user-facing workflow: `wrangler tail` while running 5-user curl
  probes correctly surfaced the AiError 9015 message in one cycle.
  Total elapsed v0.1.5 deploy → v0.1.7 fix: ~90 minutes.

[0.1.7]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.7

## [0.1.6] — 2026-05-21

Same-day follow-up to v0.1.5 surfacing three issues caught in the
post-deploy walkthrough.

### Fixed

- **`workers/api/src/services/ai.ts` — AI picks B6 root cause.**
  Switched `AI_MODEL_ID` from `@cf/meta/llama-3.1-8b-instruct-fast`
  (which TASK-006 in v0.1.5 measured at 100% fallback rate against
  prod) to `@cf/meta/llama-3.1-8b-instruct`. Cloudflare appears to
  have deprecated the `-fast` variant — the non-`-fast` base is the
  current stable id per `developers.cloudflare.com/workers-ai/models/`.
  The v0.1.5 observability (`[ai] fallback reason=…` log lines per
  branch) will identify a different failure mode if this turns out to
  be wrong; re-run the diagnostic recipe in `instruction/work/test-report.md`
  if `/v1/recommendations` still returns `fallback:true` after the
  v0.1.6 deploy.
- **`packages/react/src/components/ScratchCard/index.tsx` — Canvas2D
  readback opt-in.** `canvas.getContext("2d")` now passes
  `{ willReadFrequently: true }`. The component's `sample()` loop calls
  `getImageData` on every `requestAnimationFrame` tick during a scratch
  drag — Chrome was warning "Multiple readback operations using
  getImageData are faster with the willReadFrequently attribute set
  to true." Browser console is now clean during scratch interactions.

### Added

- **`apps/demo/src/panels/BadgeWall.tsx` — earned-badges floating
  panel.** New top-left FAB labelled "🏆 Badges N" that expands to a
  grid of badges the user has actually earned. Derives the list
  client-side from `useMissions()` — a badge is "earned" iff its
  backing mission has `progress.status === "claimed"` AND
  `mission.reward.kind === "badge"`. No DB schema change, no new
  endpoint: the existing mission-claim path is already the
  persistence layer. Includes per-badge emoji map (Power User ⚡,
  Curious Mind 🔍, Daily Visitor 📅, Lucky Spinner 🎰, Scratch
  Master 🎫) with a `🏅` fallback for unknown ids so a future seed
  migration adds a badge without breaking the render. Empty state
  reads "No badges yet — claim a mission to earn your first!" Code-split
  via `React.lazy` like the other floating panels so initial
  LCP is unaffected. Closes the v0.1.5 walkthrough question: "where
  do I see the badges I've earned?"

### Notes

- The streaming route's local `binge_starter` celebration toast is
  intentionally NOT shown in BadgeWall — it has no backing
  server-side mission, so a reload would silently drop it. If a
  future phase wants `binge_starter` in the wall, the right move is
  to add a real mission to the seed.

[0.1.6]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.6

## [0.1.5] — 2026-05-21

Bug-fix sweep driven by the live production smoke of v0.1.4. Closes
the 4 user-reported "ghost claim" bugs (B1/B3/B4/B5) and the six D1–D6
polish items from Phase 8 walkthrough. Also closes the carried-over
CI Playwright E2E gate (TASK-011) on the code side.

### Fixed

- **`packages/types/src/sdk-update.ts` + `workers/api/src/routes/missions.ts` +
  `packages/react/src/hooks/useMissions.ts` — `mission.claimed` SSE event.**
  POST `/v1/missions/:id/claim` now broadcasts three events in order:
  `mission.claimed` (status flip) → `reward.granted` (toast trigger) →
  `balance.changed` (header pulse, if currency). The hook handler routes
  `mission.claimed` through the same terminal-overwrite branch as
  `mission.completed`. **Defense in depth:** `useMissionClaim` now accepts
  an optional `onClaimed` callback, wired in `/streaming` and `/daily`
  routes to call `useMissions().refetch()` after a 200 response —
  guaranteeing UI convergence even when the `waitUntil`-detached SSE
  broadcast drops. `MissionList` self-refetches its internal `useMissions`
  for the `/ecommerce` route where the hook isn't reachable from outside.
  Covers user-reported B1 + Phase 8 D2.
- **`apps/demo/src/routes/streaming.tsx` + `apps/demo/src/routes/daily.tsx`
  — widgets derive from server state.** "Today's progress" on `/streaming`
  now reads `currentCount` from `useMissions().progress["mis_stream_documentary_3"]`
  with `Math.min(current, target)` clamp. Daily streak hero on `/daily`
  drops `localStorage` entirely and derives `claimedToday` from
  `progress.updatedAt` falling in today's UTC window + `currentCount > 0`.
  The Binge Starter celebration on `/streaming` now triggers from the
  server-derived count crossing the target via `useRef`+`useEffect`
  (guarded so reloads with prior progress don't re-celebrate). Covers
  user-reported B3 + B4 + Phase 8 D1.
- **`apps/demo/src/routes/minigames.tsx` — honest toast labels.**
  Wheel slices and scratch card no longer claim coin amounts the server
  never mints. All `WHEEL_SLICES` entries now carry
  `{kind:"badge",badgeId:"lucky_spinner"}` (the actual reward from
  migration 0004). Scratch reveal calls
  `showToast({kind:"badge",badgeId:"scratch_master"})`. Captions and
  labels say "Lucky spin!" / "Scratch Master progress +1" instead of
  "+10 coin" / "+30 coin". `DemoToastHost` already supported the badge
  kind; no host changes needed. Three new worker integration tests in
  `events.route.test.ts` lock the no-currency-mint contract (even after
  5 spins that complete the Lucky Spinner mission, the `balances` table
  remains empty). Covers user-reported B5 + Phase 8 D6.
- **`apps/demo/src/components/Layout.tsx` — footer reads from
  `package.json`.** The hardcoded `v0.1.0` string is gone. Imported the
  root `package.json` via `import pkg from "../../../../package.json"`
  (Vite + TypeScript handle JSON natively with the existing
  `resolveJsonModule: true`). Next version bump auto-propagates. New
  `Layout.test.tsx` (with a Jest scaffold added to the demo app)
  pins the contract. Covers Phase 8 D5.

### Added

- **`workers/api/src/services/ai.ts` — distinct fallback observability.**
  `normalizeAiEnvelope` now returns an `EnvelopeOutcome` with a
  `strategy` field, and the `env.AI.run(...)` call is wrapped in a
  try/catch. Three distinct `console.warn` reasons:
  `[ai] fallback reason=ai-run-threw …`,
  `[ai] fallback reason=envelope-not-an-object …`, and
  `[ai] fallback reason=envelope-no-strategy-matched fingerprint=…`.
  Fingerprint is a bounded ~200-char structural summary of top-level
  keys + value types/lengths — values are NEVER logged. Operator can
  grep `[ai] fallback reason=` in `wrangler tail` to identify the
  exact branch. Investigation spike (TASK-006) confirmed a 5/5
  production fallback rate against `https://api.questkit.jairukchan.com/v1/recommendations`
  with fresh users — escalated to Phase 10 with the diagnostic recipe
  in `instruction/work/test-report.md`.
- **`workers/api/src/rules/evaluator.test.ts` — Curious Mind
  regression tests.** Four new cases pin the
  `{"filter":{"genre":{"eq":"documentary"}}}` behaviour against the
  `mis_stream_documentary_3` seed criteria: documentary matches,
  drama rejected, missing-genre rejected, three-watch lifetime
  completion. Phase 8 D4 audit verdict: rule was already correct; the
  test locks it against future drift.
- **`packages/react/test/hooks/useMissions.test.tsx` — D3 contract
  test.** Confirms `onFireEventSuccess(missionsUpdated)` only bumps
  mission IDs explicitly listed (the server-side `evaluate()` filter
  in `workers/api/src/rules/evaluator.ts` is the authoritative gate;
  non-qualifying events are structurally unreachable in the
  optimistic path). Phase 8 D3 verdict: non-bug; test regression pin.
- **`apps/demo/e2e/claim-flow.spec.ts` — cross-route claim E2E.**
  Three Playwright tests verify post-claim widget convergence + no
  navigation across `/ecommerce`, `/streaming`, `/daily`. Listed
  6 entries across the chromium-desktop + mobile-chrome projects.
- **`apps/demo/e2e/minigames.spec.ts` — toast honesty E2E.** Two new
  tests asserting that neither the spin wheel nor scratch card
  surface mentions "coin" anywhere user-visible.
- **CI bypass for Cloudflare Bot Management (code side):**
  `apps/demo/playwright.config.ts` attaches
  `x-questkit-ci-bypass: $CI_BOT_BYPASS_TOKEN` to all requests when
  `E2E_TARGET=prod` and the env var is set; otherwise the header is
  omitted (local mode unaffected, prod-without-secret unaffected).
  `.github/workflows/deploy.yml` passes the secret to the E2E step.
  `docs/SELF_HOSTING.md` §8.6 documents the full setup: generate
  secret via `openssl rand -hex 32`, store as GH secret
  `CI_BOT_BYPASS_TOKEN`, create CF WAF custom rule scoped to
  `POST /api/token` with the matching header → action `Skip` Super
  Bot Fight Mode + All managed rules. Rotation procedure included.
  Closes Phase 8 TASK-011 carry-over on the code side. The two manual
  dashboard steps (GH secret + CF rule) are out-of-scope for an
  agent and listed in the deploy notes.

### Notes for maintainers

- **B6 (AI picks "unavailable right now") is REAL** — the TASK-006
  spike measured 5/5 = 100% fallback rate against prod with fresh
  users. Three hypotheses ranked in `instruction/work/test-report.md`;
  the next phase should re-run the diagnostic recipe and either bump
  `AI_MODEL_ID` in `workers/api/src/services/ai.ts:55` or add a 4th
  envelope strategy to `normalizeAiEnvelope`. Acceptance: re-run
  the 5-user verification with rate `< 20%`.
- **Server-side coin mint for minigames** is intentionally
  out-of-scope — Phase 9 fixed only the lying-label bug (B5
  option a). Wiring real currency rewards to `qk.minigame.spin` /
  `qk.minigame.scratch` is a Phase 10 candidate.

[0.1.5]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.5

## [0.1.4] — 2026-05-21

Demo stability & production hardening — 8 in-scope tasks plus a manual
browser walkthrough. CI builds workspace dependencies before static
assets, reproducible deploy with D1 migrations, and a Playwright E2E
suite running against the live deploy. Production at
`https://questkit.jairukchan.com` confirmed via `/v1/health` returning
`version:"0.1.4"`.

### Fixed

- **`workers/api/src/routes/missions.ts` — SSE broadcast deadlock.**
  The claim path held the response on the SSE_HUB DO RPC, causing
  "claim hangs forever" when the DO was wedged. Both `stub.fetch` calls
  now arm `AbortSignal.timeout(2000)`, and the whole `tryBroadcastClaim`
  call is detached via `c.executionCtx.waitUntil(...)` so broadcast
  latency never gates the client response.
- **`workers/api/src/services/ai.ts` — AI 502 envelope mismatch.**
  `normalizeAiEnvelope` accepts three Workers-AI response shapes
  (string / object with `response` / object with `result.response`) and
  falls back gracefully when none matches. No client cache writes for
  fallback results.
- **`packages/core/src/sse.ts` + `polling.ts` + `client.ts` — `Illegal
invocation` from unbound `fetch`.** Three sites that stored the
  browser's native `fetch` as a class property and called it as a
  method. All now use the wrapped `authedFetch` helper.
- **`workers/api/src/db/schema.ts:722` — counter-cap CAS race.** The
  rule engine's `completed → claimed` transition is gated by a
  CAS-style WHERE clause so two concurrent claims can't double-mint.
- **Browser fetch timeouts in `packages/core`** — every outbound call
  now arms `AbortSignal.timeout(...)` so a wedged worker never hangs
  the demo UI.

### Added

- **`POST /v1/demo/reset` — server-side demo reset endpoint.** Wipes
  the `balances` + `mission_progress` rows for the demo user without
  recreating the JWT. Surfaced via the DevTools panel.
- **TASK-006 optimistic counter updates** — `useMissions` subscribes
  to `client.onFireEventSuccess(missionsUpdated)` and bumps
  `currentCount + 1` (clamped at `targetCount`) for any mission
  acknowledged by the server-side rule engine. Authoritative SSE +
  refetch use a monotonic `Math.max(existing.currentCount, p.currentCount)`
  merge to avoid visible regressions when optimistic state is briefly
  ahead.
- **Reproducible CI deploy** via `.github/workflows/deploy.yml` —
  `workflow_run` after CI on `main`, applies D1 migrations, deploys
  6 workers in dependency order, post-deploy `/v1/health` smoke and
  Playwright E2E gate against the live apex.
- **Migrations 0003 + 0004** — `mis_daily_visitor` (count=1,
  daily) and minigame missions (`mis_lucky_spinner` ×5 spin
  lifetime, `mis_scratch_master` ×3 scratch lifetime), both badge
  rewards.

### Notes

- **Phase 8 CI E2E gate is structurally complete but red** under
  Cloudflare Bot Management — runner IPs are challenged on
  `POST /api/token`. The smoke step accepts the CF managed-challenge
  body as a route-up signal so a live deploy still passes its smoke
  gate. The full CI bypass landed in v0.1.5 TASK-005.

[0.1.4]: https://github.com/ilGentEAcutoO/QuestKit/releases/tag/v0.1.4

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
