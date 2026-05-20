/**
 * Vitest config for `questkit-worker-webhook-consumer` — mirrors the api /
 * webhook-relay pattern (`@cloudflare/vitest-pool-workers` 0.16+ via the
 * `cloudflareTest` plugin inside `defineConfig`).
 *
 * Key differences from sibling workers:
 *   - No D1, no KV, no AE: the consumer has zero direct bindings — it only
 *     talks to the api worker via RPC. Test code injects a fake `env.API`.
 *   - No `services` binding declared (see wrangler.test.jsonc) — pool-workers
 *     can't resolve cross-worker entrypoint stubs in test mode, so we hand a
 *     plain object as `env` to `getQueueResult` per the L1-aware pattern from
 *     plan §10.2.
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
    }),
  ],
  test: {
    coverage: {
      // Pool-workers only supports istanbul (v8 is not allowed inside workerd).
      provider: "istanbul",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/index.ts", // entry-file glue; covered via integration tests
      ],
    },
  },
});
