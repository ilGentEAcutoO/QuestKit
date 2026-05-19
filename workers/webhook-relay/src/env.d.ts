/**
 * Env augmentation for fields not (yet) inferred by `wrangler types`.
 *
 * Production secrets are set via `wrangler secret put` and aren't part of the
 * generated `worker-configuration.d.ts`. We declare them here so app code is
 * fully typed; if a future wrangler version emits these properties, this file
 * becomes a no-op (TypeScript merges identical declarations).
 */
export {};

declare global {
  interface Env {
    /** HMAC-SHA256 key for inbound webhook signature verification. */
    WEBHOOK_HMAC_SECRET: string;
  }

  // The pool-workers `cloudflare:test` module types `env` as `Cloudflare.Env`.
  namespace Cloudflare {
    interface Env {
      WEBHOOK_HMAC_SECRET: string;
    }
  }
}
