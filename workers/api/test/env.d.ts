/**
 * Test-only type augmentation. Pulls in:
 *   - `cloudflare:test` ambient module (env, SELF, applyD1Migrations, ...)
 *     exposed by @cloudflare/vitest-pool-workers via its `/types` subpath.
 *
 * Located in test/ so it's only seen by `tsc` when test files are in the
 * include list, and never bundled into the deploy artefact.
 */
/// <reference types="@cloudflare/vitest-pool-workers/types" />

export {};
