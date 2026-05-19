/**
 * Vitest config for `questkit-worker-webhook-relay` — mirrors the api worker
 * pattern (`@cloudflare/vitest-pool-workers` 0.16+ via the `cloudflareTest`
 * plugin inside `defineConfig`).
 *
 * Differences from the api worker config:
 *   - No D1 migrations: this worker has no D1 binding.
 *   - One secret only: WEBHOOK_HMAC_SECRET (obviously-fake; committed; matches
 *     the literal used in test/{hmac,route}.test.ts).
 *   - Test wrangler config (wrangler.test.jsonc) is identical to production in
 *     this case because we have no remote-only bindings (no AI, no DOs).
 */
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Obviously-fake test secret. Gitleaks allowlist already covers `*.test.*`
// and `vitest.config.*`. The literal here must match the string used in the
// test files — pool-workers injects it onto c.env.WEBHOOK_HMAC_SECRET.
const TEST_WEBHOOK_HMAC_SECRET =
  "test_webhook_hmac_secret_do_not_use_in_prod_only_for_vitest";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        bindings: {
          WEBHOOK_HMAC_SECRET: TEST_WEBHOOK_HMAC_SECRET,
        },
      },
    }),
  ],
  test: {
    coverage: {
      // Pool-workers only supports istanbul (v8 is not allowed inside workerd).
      provider: "istanbul",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/index.ts", // entry-file glue; covered via integration tests
      ],
    },
  },
});
