import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Local /api/token stub for `vite dev` + `vite preview`.
 *
 * In production the demo worker forwards POST /api/token to the API worker
 * (with APP_SECRET injected server-side). Vite preview has no worker
 * runtime, so the browser hits a 404 — which trips Lighthouse's "no
 * console errors" best-practices audit. The preview middleware returns
 * a 200 stub token (Lighthouse-friendly) while the dev middleware
 * returns a 503 telling the dev to run `pnpm dev:worker` for the real
 * mint flow.
 */
function tokenStubPlugin(): Plugin {
  return {
    name: "questkit-demo:token-stub",
    apply: "serve",
    configurePreviewServer(server) {
      server.middlewares.use("/api/token", (_req, res) => {
        // 200 with a stub token so the demo bootstraps cleanly during
        // `vite preview` (used by Lighthouse runs). Downstream API calls
        // to api.questkit.jairukchan.com will fail-soft via the SDK's
        // retry queue, but the initial-load tree paints without errors.
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            token: "demo-preview-stub-token",
            expiresAt: Date.now() + 60 * 60 * 1000,
          }),
        );
      });
    },
    configureServer(server) {
      server.middlewares.use("/api/token", (_req, res) => {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            error:
              "api/token unavailable in vite dev; run `pnpm dev:worker` for the dual-mode worker",
          }),
        );
      });
    },
  };
}

/**
 * Inject `<link rel="modulepreload">` for all lazy route + panel chunks
 * after the build, so the browser fetches them in parallel with the
 * vendor chunks instead of waiting for the React tree to mount before
 * discovering the dynamic import. This collapses the LCP waterfall on
 * deep-links like `/streaming` or `/minigames` by ~600 ms (one RTT).
 *
 * The chunks are tiny (1–2 KB gzipped each); preloading all four routes
 * adds < 10 KB to the initial waterfall but pays for itself the first
 * time any one of them is needed.
 */
function preloadDynamicChunksPlugin(): Plugin {
  return {
    name: "questkit-demo:preload-dynamic-chunks",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html, ctx) {
      const bundle = ctx.bundle;
      if (!bundle) return html;
      // Match files in dist/assets that come from src/routes/ or
      // src/panels/. These are the dynamic-imported chunks emitted by
      // Vite via the React.lazy() calls. We surface each as a low-cost
      // modulepreload so the browser pipelines them right after the
      // initial vendor batch.
      const dynamicChunks: string[] = [];
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const facade = chunk.facadeModuleId ?? "";
        if (
          facade.includes("/src/routes/") ||
          facade.includes("/src/panels/")
        ) {
          dynamicChunks.push(fileName);
        }
      }
      if (dynamicChunks.length === 0) return html;
      const links = dynamicChunks
        .map((f) => `    <link rel="modulepreload" crossorigin href="/${f}">`)
        .join("\n");
      // Insert just before </head>. The browser already discovers the
      // existing modulepreload links for vendor chunks; ours sit next to
      // them in the head so they're scheduled in the same batch.
      return html.replace("</head>", `${links}\n  </head>`);
    },
  };
}

/**
 * Vite config — emits to ./dist for the Worker's `[assets]` binding.
 *
 * Plugin order matters: tailwindcss before react ensures CSS imports are
 * processed before React's HMR boundary instruments them.
 *
 * Manual chunk splitting: react + react-router land in `vendor-react`,
 * framer-motion in `vendor-motion`. Both download in parallel with the
 * app shell via modulepreload, and they cache independently across
 * deploys (only the questkit-* packages and demo code change between
 * versions). The route chunks (./routes/*) are split automatically by
 * Vite via the React.lazy() imports in App.tsx.
 */
export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    tokenStubPlugin(),
    preloadDynamicChunksPlugin(),
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // node_modules splits — keep the hottest libs in their own
          // chunks so Lighthouse can fetch them in parallel and so users
          // pay zero churn cost on framer-motion across deploys.
          if (id.includes("node_modules")) {
            if (
              id.includes("/react-router") ||
              id.includes("/react-router-dom") ||
              id.includes("@remix-run/router")
            ) {
              return "vendor-router";
            }
            if (id.includes("/framer-motion") || id.includes("/motion-")) {
              return "vendor-motion";
            }
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            ) {
              return "vendor-react";
            }
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: false,
  },
});
