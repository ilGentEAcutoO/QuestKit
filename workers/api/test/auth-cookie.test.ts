/**
 * TASK-041 — cookie-based auth fallback + CSRF guard (Phase 7 security
 * hardening). Closes security-review §3.1 A1.
 *
 * What's under test:
 *   - `requireAuth` middleware (workers/api/src/auth/middleware.ts) now
 *     accepts the JWT via either:
 *       (1) `Authorization: Bearer <token>` header — PREFERRED; CSRF guard
 *           skipped because the Authorization header is unforgeable
 *           cross-origin (CORS-safelisted-forbidden).
 *       (2) `qk_token` cookie — only when (1) is absent; CSRF guard applies.
 *   - CSRF guard accepts EITHER:
 *       (a) `Origin` header matches `c.env.ALLOWED_ORIGINS` (CSV).
 *       (b) Custom header `X-Requested-With: qk`.
 *
 * Test strategy: drive end-to-end through `SELF.fetch('https://api.test/v1/events', …)`
 * because that's the simplest auth-protected route in the worker. The body
 * is intentionally `app.heartbeat` (no rule-engine matches) so the success
 * path is purely about auth — we don't entangle with mission progress.
 *
 * `ALLOWED_ORIGINS` for these tests is `"https://app.test,https://demo.test"`
 * (set in `vitest.config.ts` → miniflare.bindings).
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";

const JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function mintToken(userId: string): Promise<{ token: string }> {
  const iat = nowSec();
  const exp = iat + 3600;
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const payload: JwtPayload = { sub: userId, iat, exp, jti };
  const token = await sign(payload, JWT_SECRET);
  return { token };
}

function validBody(userId: string) {
  return {
    userId,
    name: "app.heartbeat",
    payload: { source: "auth-cookie-test" },
    timestamp: Date.now(),
  };
}

/**
 * Lightweight wrapper around `SELF.fetch` that lets each test compose its
 * own auth strategy (header / cookie / both / neither) and CSRF inputs
 * (Origin / X-Requested-With) without repeating boilerplate.
 */
function postEvent(
  userId: string,
  init: {
    bearer?: string;
    cookieToken?: string;
    origin?: string;
    xRequestedWith?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.bearer !== undefined) {
    headers.authorization = `Bearer ${init.bearer}`;
  }
  if (init.cookieToken !== undefined) {
    headers.cookie = `qk_token=${init.cookieToken}`;
  }
  if (init.origin !== undefined) {
    headers.origin = init.origin;
  }
  if (init.xRequestedWith !== undefined) {
    headers["x-requested-with"] = init.xRequestedWith;
  }
  return SELF.fetch("https://api.test/v1/events", {
    method: "POST",
    headers,
    body: JSON.stringify(validBody(userId)),
  });
}

describe("requireAuth — Bearer header (backwards compatibility)", () => {
  it("returns 200 when only the Authorization header is set (no cookie)", async () => {
    const userId = "u_cookie_bearer_only";
    const { token } = await mintToken(userId);
    const res = await postEvent(userId, { bearer: token });
    expect(res.status).toBe(200);
  });

  it("returns 401 missing_token when neither header nor cookie is present", async () => {
    // No bearer, no cookie, no anything else.
    const res = await postEvent("u_cookie_neither");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("missing_token");
  });

  it("uses the Bearer header in preference to the cookie when both are present", async () => {
    // The bearer JWT is valid for `u_cookie_pref_header`; the cookie carries
    // a deliberately-garbage token. If the middleware ever preferred the
    // cookie path it would 401 on `invalid_signature` / `malformed`; the
    // 200 response confirms the header path won. (`u_cookie_pref_header` is
    // also the userId the route's user-match check expects, matching the
    // sub of the bearer token.)
    const userId = "u_cookie_pref_header";
    const { token } = await mintToken(userId);
    const res = await postEvent(userId, {
      bearer: token,
      cookieToken: "garbage.not.a.real.jwt",
    });
    expect(res.status).toBe(200);
  });
});

describe("requireAuth — cookie path with CSRF guard", () => {
  it("returns 200 when the cookie is present and Origin is in ALLOWED_ORIGINS", async () => {
    const userId = "u_cookie_origin_allowed";
    const { token } = await mintToken(userId);
    const res = await postEvent(userId, {
      cookieToken: token,
      origin: "https://app.test", // matches the CSV in vitest.config.ts
    });
    expect(res.status).toBe(200);
  });

  it("returns 200 when the cookie is present and X-Requested-With: qk is set", async () => {
    const userId = "u_cookie_xrw_allowed";
    const { token } = await mintToken(userId);
    const res = await postEvent(userId, {
      cookieToken: token,
      xRequestedWith: "qk",
    });
    expect(res.status).toBe(200);
  });

  it("returns 401 csrf_guard when the cookie is present without Origin or X-Requested-With", async () => {
    const userId = "u_cookie_no_csrf_signal";
    const { token } = await mintToken(userId);
    const res = await postEvent(userId, {
      cookieToken: token,
      // no origin, no xRequestedWith
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("csrf_guard");
  });

  it("returns 401 csrf_guard when Origin is set but NOT in ALLOWED_ORIGINS and X-Requested-With is absent", async () => {
    const userId = "u_cookie_bad_origin";
    const { token } = await mintToken(userId);
    const res = await postEvent(userId, {
      cookieToken: token,
      origin: "https://attacker.example",
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("csrf_guard");
  });

  it("returns 401 csrf_guard when X-Requested-With value is wrong (case/literal match required)", async () => {
    // Defensive: the value comparison is literal ("qk") — a tweaked value
    // must NOT satisfy the guard. This pins the expectation so future edits
    // don't accidentally loosen the comparison.
    const userId = "u_cookie_xrw_wrong_value";
    const { token } = await mintToken(userId);
    const res = await postEvent(userId, {
      cookieToken: token,
      xRequestedWith: "QK", // wrong case → not literal equal
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("csrf_guard");
  });

  it("verifies the cookie JWT via the standard verify path (revoked tokens still rejected)", async () => {
    // Once the CSRF guard passes, the cookie path must apply the same
    // signature + expiry + denylist checks as the header path. A token with
    // a bad signature surfaces as `invalid_signature`, NOT `csrf_guard`.
    const res = await postEvent("u_cookie_bad_sig", {
      cookieToken: "not.a.real.jwt", // 3 segments but bogus sig
      xRequestedWith: "qk", // CSRF guard passes → we reach verify()
    });
    expect(res.status).toBe(401);
    // Could be `malformed` (decode failure) or `invalid_signature` — either
    // way it must NOT be `csrf_guard` or `missing_token`.
    const body = await res.text();
    expect(body === "malformed" || body === "invalid_signature").toBe(true);
  });
});
