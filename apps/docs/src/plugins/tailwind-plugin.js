/**
 * Wires Tailwind v4's PostCSS plugin into the Docusaurus build and patches a
 * Node-25 SSR build incompatibility.
 *
 * Two responsibilities:
 *
 * 1. **PostCSS chain (Tailwind v4)** — Docusaurus 3 owns its webpack/Rspack
 *    PostCSS config, so a standalone `postcss.config.js` at the package root
 *    is ignored. `configurePostCss` is the supported extension point; we push
 *    `@tailwindcss/postcss` into the plugin chain so `@import "tailwindcss"`
 *    in `src/css/custom.css` produces real utility CSS.
 *
 * 2. **Node-25 SSR shims** — Docusaurus computes its server-side webpack
 *    target as `node${major}.${minor}` from `process.versions.node`. Node 25
 *    is unknown to webpack 5's Browserslist-Targets table, so AST-rewrite
 *    passes that depend on a recognised node target silently disable
 *    themselves — most notably the rewrite that turns
 *    `require.resolveWeak(id)` into `__webpack_require__.resolveWeak(id)`.
 *
 *    `require.resolveWeak` is webpack-only; on the SSR eval host it doesn't
 *    exist. We inject a BannerPlugin into the server bundle that defines a
 *    no-op `resolveWeak` if missing. The return value is only used for
 *    chunk-preload metadata that never reaches rendered HTML, so identity is
 *    a safe shim.
 *
 *    The `.nvmrc` is already pinned to Node 22, and CI follows it, so
 *    canonical builds never exercise this path. The shim only matters when a
 *    developer runs `pnpm build` under Node 24+.
 *
 *    Upstream tracking: https://github.com/facebook/docusaurus/issues/11545
 *    Once Docusaurus pins the SSR target to a known Node major (or webpack
 *    learns about Node 24+), this entire branch can be deleted.
 *
 * Reference: https://docusaurus.io/docs/api/plugin-methods/lifecycle-apis#configureWebpack
 */
module.exports = function tailwindPlugin() {
  return {
    name: "questkit-tailwind-plugin",

    configurePostCss(postcssOptions) {
      postcssOptions.plugins.push(require("@tailwindcss/postcss"));
      return postcssOptions;
    },

    configureWebpack(_config, isServer, { currentBundler }) {
      if (!isServer) return {};
      const { BannerPlugin } = currentBundler.instance;
      const shim = [
        "(function () {",
        '  if (typeof require === "undefined" || !require) return;',
        '  if (typeof require.resolveWeak !== "function") {',
        "    require.resolveWeak = function resolveWeak(id) { return id; };",
        "  }",
        "})();",
      ].join("\n");
      return {
        plugins: [
          new BannerPlugin({
            banner: shim,
            raw: true,
            entryOnly: true,
          }),
        ],
      };
    },
  };
};
