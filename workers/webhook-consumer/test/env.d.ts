/**
 * Test-only type augmentation. Pulls in the `cloudflare:test` ambient module
 * (env, SELF, createMessageBatch, getQueueResult, …) exposed by
 * @cloudflare/vitest-pool-workers via its `/types` subpath.
 */
/// <reference types="@cloudflare/vitest-pool-workers/types" />

export {};
