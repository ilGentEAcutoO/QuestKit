import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  // Treeshake aggressively — every byte counts for the 15 KB gzipped budget.
  treeshake: true,
  // Use the same extension scheme as @questkit/types (.js + .cjs side-by-side).
  fixedExtension: false,
  // Keep the bundle readable; consumers' bundlers will minify in their step.
  minify: false,
  // `@questkit/types` is type-only — no runtime imports cross the boundary,
  // so leaving it bundled is free. No other externals: fetch / ReadableStream
  // / TextDecoder / crypto.randomUUID are all platform built-ins.
  // (Use `neverBundle: []` instead of the deprecated `external` field.)
});
