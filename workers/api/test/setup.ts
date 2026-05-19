/**
 * Vitest setup — applies D1 migrations to env.DB so tests can hit real tables.
 *
 * Runs once per test file via vitest config `setupFiles`. `applyD1Migrations`
 * is idempotent (it records applied migrations in `d1_migrations`) so re-runs
 * across files cost a single SELECT.
 *
 * The migration list is computed in Node by vitest.config.ts (using wrangler's
 * `unstable_splitSqlQuery` via `readD1Migrations`) and serialised onto the
 * miniflare binding `QK_D1_MIGRATIONS_JSON`. We just parse and apply.
 */
import { applyD1Migrations, type D1Migration, env } from "cloudflare:test";
import { beforeAll } from "vitest";

beforeAll(async () => {
  const raw = (env as unknown as Record<string, string>).QK_D1_MIGRATIONS_JSON;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new Error(
      "setup.ts: missing QK_D1_MIGRATIONS_JSON binding — check vitest.config.ts",
    );
  }
  const migrations = JSON.parse(raw) as D1Migration[];
  await applyD1Migrations(env.DB, migrations);
});
