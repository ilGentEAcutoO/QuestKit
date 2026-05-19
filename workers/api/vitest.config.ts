/**
 * Vitest config for `questkit-worker-api` — runs tests inside the workerd
 * runtime via `@cloudflare/vitest-pool-workers` 0.16.x.
 *
 * Why this shape?
 *   - 0.16 deprecated the `defineWorkersProject` / `@cloudflare/.../config`
 *     helper. The new model registers `cloudflareTest(...)` as a Vite plugin
 *     inside `defineConfig` from `vitest/config`. (See the official codemod at
 *     node_modules/@cloudflare/vitest-pool-workers/dist/codemods/vitest-v3-to-v4.mjs)
 *   - The plugin receives our wrangler.jsonc so all bindings (DB, CACHE, etc.)
 *     are auto-provisioned by miniflare with names matching the production
 *     config.
 *   - Test-only env vars (JWT_SECRET, APP_SECRET) are injected via
 *     `miniflare.bindings` — these are obviously fake values; the literal
 *     strings here are committed and must match what the test suites read.
 *   - D1 migrations from ./migrations are read in Node-side here (via the
 *     official `readD1Migrations` + `wrangler.unstable_splitSqlQuery` pair)
 *     and passed to the worker-side `setupFiles` via vitest's `provide`/
 *     `inject` bridge so the SQL is parsed correctly (comments, multi-line
 *     statements, etc. — naive split-on-`;` breaks our `0001_init.sql`).
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Resolve ./migrations relative to this config (ESM `__dirname` shim).
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(__dirname, "./migrations");

// Read + properly parse migrations at config load. `readD1Migrations` calls
// wrangler's `unstable_splitSqlQuery` which handles SQL comments and string
// literals correctly — a naive `.split(";")` corrupts our 0001_init.sql.
const migrations = await readD1Migrations(migrationsDir);

// Obviously-fake secrets — these are TEST ONLY and committed deliberately.
// They never reach a real environment. Pool-workers injects them into the
// worker's Env at miniflare-init time so c.env.JWT_SECRET / c.env.APP_SECRET
// resolve correctly inside SELF.fetch() calls.
const TEST_JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TEST_APP_SECRET = "test_app_secret_do_not_use_in_prod_xxxxxxxxxxxxxxx";
const TEST_WEBHOOK_HMAC_SECRET =
  "test_webhook_hmac_do_not_use_in_prod_yyyyyyyyyyyyyyyyyyyyyyyyyyy";

export default defineConfig({
  plugins: [
    cloudflareTest({
      // wrangler.test.jsonc mirrors production (wrangler.jsonc) MINUS the
      // `ai` binding. Workers AI has no local emulator; pool-workers 0.16
      // tries to open a remote-proxy session which fails in CI without
      // CLOUDFLARE_API_TOKEN. No current test uses env.AI (lands in TASK-017),
      // so the cleanest CI-compatible workaround is to omit it here.
      wrangler: { configPath: "./wrangler.test.jsonc" },
      miniflare: {
        // `bindings` is the miniflare-level name for env vars / secrets. They
        // appear on c.env at runtime exactly like a `wrangler.toml` [vars]
        // block or a `wrangler secret put` value.
        bindings: {
          JWT_SECRET: TEST_JWT_SECRET,
          APP_SECRET: TEST_APP_SECRET,
          WEBHOOK_HMAC_SECRET: TEST_WEBHOOK_HMAC_SECRET,
          // Parsed migrations as a serialisable JSON string — `setup.ts`
          // reads, parses, and feeds the array to `applyD1Migrations`.
          // (We don't use `provide`/`inject` because the worker pool runs
          // tests in workerd where vitest's serialisation channel for those
          // helpers is restricted; a plain string binding is simplest.)
          QK_D1_MIGRATIONS_JSON: JSON.stringify(migrations),
        },
      },
    }),
  ],
  test: {
    // Applies D1 migrations to env.DB once per test file.
    setupFiles: ["./test/setup.ts"],
    coverage: {
      // Pool-workers only supports istanbul (v8 is not allowed inside workerd
      // — confirmed by the runtime check in dist/pool/index.mjs).
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
