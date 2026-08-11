# QuestKit docs (unplugged)

This Docusaurus app is **not part of the monorepo workspace** right now.

**Why:** `@docusaurus/mdx-loader` depends on `image-size@<=2.0.2`, which is
flagged by [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq)
(JXL/HEIF DoS). No patched version exists on npm yet (`first_patched_version: null`).

**Re-enable when fixed:**

1. Confirm `image-size` has a release > 2.0.2 (or Docusaurus drops the dep).
2. Add `"apps/docs"` back to root `pnpm-workspace.yaml`.
3. `pnpm install` and `pnpm --filter @questkit/docs build`.

Source under this folder is kept for later; it is just not installed/scanned
via the root lockfile.
