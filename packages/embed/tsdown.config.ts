import { defineConfig } from "tsdown";

/**
 * IIFE build for `<script>`-tag embedding.
 *
 * The embed bundle is dropped onto *any* host page, so every transitive
 * dep MUST be inlined. This is the inverse of the @questkit/react config
 * (which marks react/types/core `neverBundle`). Here, we set
 * `deps.alwaysBundle` for the same packages so a single `questkit.iife.js`
 * carries everything the host needs.
 *
 * Constraints (tsdown 0.22 IIFE):
 *   - single entry only (no code-splitting in IIFE format)
 *   - `globalName: "QuestKit"` writes to `window.QuestKit` at module init
 *   - `platform: "browser"` so node-only modules aren't preferred
 *   - `minify: true` for the 200 KB gzipped budget
 */
export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["iife"],
  globalName: "QuestKit",
  platform: "browser",
  minify: true,
  clean: true,
  treeshake: true,
  dts: false,
  sourcemap: false,
  fixedExtension: false,
  deps: {
    alwaysBundle: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "@questkit/core",
      "@questkit/react",
      "@questkit/types",
    ],
  },
  outputOptions: {
    entryFileNames: "questkit.iife.js",
  },
});
