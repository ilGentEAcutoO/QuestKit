/**
 * Test-only type augmentation. Pulls in the `cloudflare:test` ambient module
 * (env, SELF, …) exposed by @cloudflare/vitest-pool-workers via its `/types`
 * subpath. Mirrors workers/api/test/env.d.ts.
 */
/// <reference types="@cloudflare/vitest-pool-workers/types" />

export {};
