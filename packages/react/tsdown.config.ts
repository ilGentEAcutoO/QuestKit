import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  treeshake: true,
  fixedExtension: false,
  minify: false,
  // React + workspace types/core must NEVER be bundled — they are peerDeps
  // (react/react-dom) or sibling packages (consumers install them via the
  // monorepo / npm semver resolution). Bundling them would defeat the
  // "single React in the app" invariant.
  //
  // tsdown deprecated the top-level `external` field; use `deps.neverBundle`.
  deps: {
    neverBundle: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "@questkit/core",
      "@questkit/types",
    ],
  },
  // Note: theme.css is copied to dist/styles.css by scripts/copy-styles.mjs
  // (invoked via the `build` script in package.json). tsdown intentionally
  // doesn't process CSS itself — Tailwind v4 compilation is the consumer's
  // job, and we only need to forward the raw `@theme` block.
});
