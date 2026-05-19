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
 * 3. **SSR null-loader for `.css` (build-time)** — `@tailwindcss/postcss`
 *    causes Infima's `default.css` to land in the server bundle's module
 *    graph. We register a webpack rule that routes `.css` files through
 *    `null-loader` for the server build only. CSS is still emitted by the
 *    client bundle (which is what the browser uses); the server bundle only
 *    renders HTML and never touches real stylesheets at runtime, so
 *    swallowing them server-side is correct.
 *
 * 4. **SSR CSS extension handler (runtime, belt-and-braces)** — In this
 *    project's configuration, Webpack's CommonJS parser does NOT always
 *    process the `require("C:\\...\\some.css")` literals that Docusaurus's
 *    codegen emits inside `.docusaurus/client-modules.js`. Some of them
 *    survive into `server.bundle.js` as literal Node `require()` calls,
 *    and hit `ssgRequireFunction` at SSG time. Without an extension
 *    handler, Node tries to evaluate the CSS file as JS and throws
 *    `SyntaxError: Unexpected token ':'`. The BannerPlugin shim below
 *    registers a no-op `require.extensions['.css']` handler at the top of
 *    the server bundle so any literal CSS require evaluates to
 *    `module.exports = {}`. The webpack null-loader rule handles
 *    build-time CSS imports that DO go through the rule pipeline; the
 *    runtime extension handler is the fallback for those that don't.
 *
 * 5. **`.docusaurus/client-modules.js` null-loader** — Beyond CSS, the same
 *    `client-modules.js` file requires `prism-react-renderer` (ESM-only,
 *    breaks Node CommonJS `require()`) and `@theme/...` aliases (webpack-
 *    only, unknown to Node). All four entries in that array are CLIENT
 *    lifecycle modules — they only fire `onRouteUpdate`/`onRouteDidUpdate`
 *    in the browser, never during SSG. Routing `null-loader` at the
 *    generated `client-modules.js` source replaces it with an empty export
 *    on the server build, sparing SSG from evaluating any of those side-
 *    effectful modules. The client bundle is untouched.
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
        '  if (require.extensions && !require.extensions[".css"]) {',
        '    require.extensions[".css"] = function noopCss(module) {',
        "      module.exports = {};",
        "    };",
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
        module: {
          rules: [
            {
              test: /\.css$/,
              use: require.resolve("null-loader"),
            },
            {
              test: /[\\/]\.docusaurus[\\/]client-modules\.js$/,
              use: require.resolve("null-loader"),
            },
          ],
        },
      };
    },
  };
};
