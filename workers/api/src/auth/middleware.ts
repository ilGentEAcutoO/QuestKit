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
 *
 * TASK-041 addendum (Phase 7 security hardening): the middleware now also
 * accepts the JWT via a `qk_token` HttpOnly cookie when the `Authorization`
 * header is absent. The Bearer-header path is unchanged — existing SDK,
 * Newman, demo, and e2e callers see ZERO behavioural difference. The cookie
 * path is gated by a CSRF guard (Origin allowlist OR `X-Requested-With: qk`)
 * because cookies are auto-sent cross-origin by browsers. See
 * `apps/docs/docs/api/auth.md` → "Cookie-based auth" for the operator setup.
 */
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { JwtError, type JwtPayload, verify } from "./jwt";

interface AuthVars {
  userId: string;
  jti: string;
  /**
   * Optional capability marker from the JWT payload. Today only "demo" is
   * recognised, set by the demo mint proxy (`apps/demo/src/server/index.ts`)
   * passing `kind: "demo"` to `/v1/auth/token`. The `/v1/demo/reset` route
   * gates on this value to prevent regular users from wiping their own data
   * via the dangerous reset endpoint. Undefined for tokens minted via the
   * default path.
   */
  kind: "demo" | undefined;
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
      // -----------------------------------------------------------------
      // Token extraction — Bearer header takes precedence over cookie.
      //
      // The Authorization header is a "CORS-safelisted" forbidden request
      // header: browsers strip it on cross-origin XHR/fetch unless the
      // calling JS explicitly sets it (which itself requires a successful
      // CORS preflight). That makes it un-forgeable cross-origin and is
      // why we skip the CSRF guard for the header path.
      //
      // Cookies, in contrast, are auto-sent cross-origin by browsers and
      // need the additional guard applied below.
      // -----------------------------------------------------------------
      let token: string | undefined;
      let tokenFromCookie = false;

      const auth = c.req.header("Authorization");
      if (auth && auth.startsWith("Bearer ")) {
        const candidate = auth.slice(7).trim();
        if (candidate.length > 0) {
          token = candidate;
        }
      }

      if (token === undefined) {
        const cookieToken = getCookie(c, "qk_token");
        if (cookieToken && cookieToken.length > 0) {
          token = cookieToken;
          tokenFromCookie = true;
        }
      }

      if (token === undefined) {
        throw new HTTPException(401, { message: "missing_token" });
      }

      // -----------------------------------------------------------------
      // CSRF guard — cookie-path only.
      //
      // Either path is sufficient (OR — not AND):
      //   (a) `Origin` header matches an entry in env.ALLOWED_ORIGINS
      //       (CSV of full origins, trimmed; empty/unset env => no match).
      //   (b) Custom header `X-Requested-With: qk` (case-insensitive on
      //       the header name; literal-equality on the value). A cross-
      //       origin attacker cannot set this header without triggering
      //       a CORS preflight that the worker hasn't authorised.
      // -----------------------------------------------------------------
      if (tokenFromCookie && !passesCsrfGuard(c)) {
        throw new HTTPException(401, { message: "csrf_guard" });
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
      // `kind` is optional in the JWT — surface it on c.var so routes that
      // gate on it (e.g. `/v1/demo/reset`) can read it without re-decoding
      // the token. Only "demo" is meaningful today; anything else collapses
      // to undefined.
      c.set("kind", payload.kind === "demo" ? "demo" : undefined);
      await next();
    },
  );
}

/**
 * CSRF guard predicate, invoked only when the caller authenticated via the
 * `qk_token` cookie. Returns true if EITHER condition is satisfied:
 *
 *   - `Origin` header is present AND appears in `env.ALLOWED_ORIGINS` (CSV
 *     of full origins). Entries are trimmed; empty entries are ignored.
 *   - `X-Requested-With` header equals `qk` (literal, ASCII).
 *
 * Header reads use Hono's `c.req.header(name)` which is case-insensitive on
 * the header name (per RFC 7230). Value comparison is literal on purpose:
 * the only legitimate sender is our SDK / browser-host code under our
 * control, so we don't need to be lenient.
 */
function passesCsrfGuard(c: {
  env: Env;
  req: { header: (name: string) => string | undefined };
}): boolean {
  const xrw = c.req.header("X-Requested-With");
  if (xrw === "qk") return true;

  const origin = c.req.header("Origin");
  if (!origin) return false;

  // env.ALLOWED_ORIGINS is declared optional in `env.d.ts`; read defensively
  // so the worker still boots if the field was never set by the operator.
  const allowedRaw = c.env.ALLOWED_ORIGINS ?? "";
  if (allowedRaw.length === 0) return false;

  const allowed = allowedRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return allowed.includes(origin);
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
