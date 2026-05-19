/**
 * Env augmentation for fields not (yet) inferred by `wrangler types`.
 *
 * The generated worker-configuration.d.ts emits an `Env` interface with all
 * bindings declared in wrangler.jsonc. It does NOT emit entries for runtime
 * secrets (`wrangler secret put`) or build-time vars (`vars` block) until they
 * appear in the config; until secrets are formally declared, we declare them
 * here so app code is fully typed.
 *
 * If `wrangler types` later emits these properties, this file becomes a no-op
 * (TypeScript merges identical declarations).
 */
export {};

declare global {
  interface Env {
    /** Build-time git SHA, injected by deploy CI. Falls back to "dev" locally. */
    GIT_SHA?: string;

    /** HS256 signing key for JWTs (see /v1/auth/token). Set via `wrangler secret put JWT_SECRET`. */
    JWT_SECRET: string;

    /** HMAC-SHA256 key for inbound webhook signature verification. Set via `wrangler secret put WEBHOOK_HMAC_SECRET`. */
    WEBHOOK_HMAC_SECRET: string;

    /** App-level shared secret required by /v1/auth/token to mint user tokens. Set via `wrangler secret put APP_SECRET`. */
    APP_SECRET: string;
  }
}
