/**
 * Env augmentation — service-binding RPC signatures.
 *
 * `wrangler types` (4.90.x) generates an `Env` interface with `API: Fetcher`
 * for the cross-worker `services` binding. The Fetcher type only exposes
 * `fetch()` + `connect()`, NOT the typed RPC methods declared on the
 * `ApiService` entrypoint in workers/api/src/index.ts. This is open issue
 * cloudflare/workers-sdk#8902 — the type generator hasn't caught up to
 * `services[].entrypoint`-style RPC bindings.
 *
 * Workaround: redeclare the minimal RPC shape inline. Once 8902 closes and
 * `pnpm cf-typegen` emits the typed binding, this file becomes a redundant
 * (but TS-compatible) declaration merge — leave it as a belt-and-braces
 * guarantee that the consumer always typechecks against the canonical RPC
 * surface, even if a future api-worker change accidentally drops the
 * entrypoint export.
 */
import type { Event } from "@questkit/types";

export {};

declare global {
  /** Mirror of the `ApiService.ingestEvent` signature in workers/api. */
  interface ApiServiceRpc {
    ingestEvent: (
      event: Event,
    ) => Promise<{ accepted: boolean; missionsUpdated: string[] }>;
  }

  interface Env {
    /**
     * Service binding to `questkit-worker-api`'s `ApiService` entrypoint.
     * Declared as an intersection with `Fetcher` so callers can still use
     * `env.API.fetch(...)` if needed; we only call the typed RPC method.
     */
    API: Fetcher & ApiServiceRpc;
  }

  // Mirror onto `Cloudflare.Env` so pool-workers test code with `env` typed
  // as `Cloudflare.Env` sees the same shape.
  namespace Cloudflare {
    interface Env {
      API: Fetcher & ApiServiceRpc;
    }
  }
}
