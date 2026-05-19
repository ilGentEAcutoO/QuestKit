/**
 * Hono middleware for QuestKit auth.
 *
 * The brief explicitly says we do NOT wrap `hono/jwt` — we want full control
 * over the verify path because the denylist check needs to live INSIDE verify
 * (per plan §5 "JTI in KV denylist for revocation; 1h expiry"). Wrapping would
 * mean two round-trips through token decoding for no payoff.
 *
 * Mounted by TASK-008 on `/v1/events` and onward; this file is plumbing only
 * (TASK-007 just exposes `/v1/auth/token` which is intentionally unauthenticated).
 */
import type { MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { JwtError, type JwtPayload, verify } from "./jwt";

interface AuthVars {
  userId: string;
  jti: string;
}

/**
 * Hono middleware factory. Usage:
 *
 *   import { requireAuth } from "./auth/middleware";
 *   app.use("/v1/events", requireAuth());
 *
 * On success, `c.get("userId")` and `c.get("jti")` are set for downstream
 * handlers. On any failure, throws `HTTPException(401, ...)` which Hono
 * converts to a JSON response with the `message` as the body.
 *
 * Returns a `MiddlewareHandler` typed with the concrete Variables so the
 * caller's `c.get("userId")` resolves without `as` casts.
 */
export function requireAuth(): MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVars;
}> {
  return createMiddleware<{ Bindings: Env; Variables: AuthVars }>(
    async (c, next) => {
      const auth = c.req.header("Authorization");
      if (!auth || !auth.startsWith("Bearer ")) {
        throw new HTTPException(401, { message: "missing_token" });
      }
      const token = auth.slice(7).trim();
      if (token.length === 0) {
        throw new HTTPException(401, { message: "missing_token" });
      }

      let payload: JwtPayload;
      try {
        payload = await verify(token, c.env.JWT_SECRET);
      } catch (e) {
        const code = e instanceof JwtError ? e.code : "invalid_token";
        // Surface the JwtError.code as the error message — middleware doesn't
        // try to differentiate between "expired" / "invalid_signature" /
        // "malformed" / generic at the HTTP layer because the SDK retries on
        // 401 uniformly anyway. The code is still useful in server logs.
        throw new HTTPException(401, { message: code });
      }

      // Denylist check — per plan §5. If the JTI was revoked (via `denyToken`
      // below) the token is rejected even though the HMAC + exp are valid.
      // The KV `expirationTtl` mirrors the JWT exp, so cache entries
      // self-expire when the underlying token would have expired anyway.
      const denied = await c.env.CACHE.get(`jti:${payload.jti}`);
      if (denied !== null) {
        throw new HTTPException(401, { message: "token_revoked" });
      }

      c.set("userId", payload.sub);
      c.set("jti", payload.jti);
      await next();
    },
  );
}

/**
 * Add a JWT id to the denylist. The KV entry self-expires at the JWT's `exp`
 * (in seconds since epoch as it appears in the JWT payload) so we don't retain
 * entries longer than they're needed.
 *
 * This is plumbing for a future logout/revoke route. We expose it here so
 * tests in TASK-008 (and the eventual revoke endpoint) can call it without
 * duplicating the key-shape convention.
 */
export async function denyToken(
  env: Env,
  jti: string,
  exp: number,
): Promise<void> {
  const nowSec = Math.floor(Date.now() / 1000);
  // expirationTtl must be ≥ 60 per Cloudflare KV; if the token is already
  // within its last minute of life, store with the floor.
  const ttl = Math.max(60, exp - nowSec);
  await env.CACHE.put(`jti:${jti}`, "1", { expirationTtl: ttl });
}
