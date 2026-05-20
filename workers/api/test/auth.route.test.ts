/**
 * /v1/auth/token integration tests — TDD-first.
 *
 * These run inside the workerd test runtime; `SELF` is the bound Worker
 * (i.e. `src/index.ts`'s default export). `env` exposes bindings (DB, CACHE,
 * JWT_SECRET, APP_SECRET) configured in vitest.config.ts.
 *
 * The test JWT_SECRET / APP_SECRET come from vitest.config.ts's
 * `miniflare.bindings`. The literals here must match those.
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { verify } from "../src/auth/jwt";

const APP_SECRET = "test_app_secret_do_not_use_in_prod_xxxxxxxxxxxxxxx";

function post(body: unknown, headers: Record<string, string> = {}) {
  return SELF.fetch("https://api.test/v1/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("post /v1/auth/token", () => {
  it("returns 200 + {token, expiresAt} on valid credentials", async () => {
    const before = Date.now();
    const res = await post({
      appId: "test_app",
      appSecret: APP_SECRET,
      userId: "u_route_test_1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".")).toHaveLength(3);
    expect(typeof body.expiresAt).toBe("number");
    // expiresAt is ms-epoch, ~1h ahead of `before` (route uses now+3600s).
    const ttl = body.expiresAt - before;
    expect(ttl).toBeGreaterThanOrEqual(3590_000);
    expect(ttl).toBeLessThanOrEqual(3601_000);
  });

  it("returns 401 invalid_credentials on wrong appSecret", async () => {
    const res = await post({
      appId: "test_app",
      appSecret: "definitely_not_the_right_secret_kkkkkkkkkkkkkk",
      userId: "u_route_test_2",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_credentials");
  });

  it("returns 400 validation_error on missing fields", async () => {
    // Missing userId.
    const res = await post({ appId: "x", appSecret: APP_SECRET });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("validation_error");
  });

  it("returns 400 validation_error on malformed JSON", async () => {
    const res = await SELF.fetch("https://api.test/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 validation_error on empty appId / appSecret / userId", async () => {
    const res = await post({
      appId: "",
      appSecret: APP_SECRET,
      userId: "u_x",
    });
    expect(res.status).toBe(400);
  });

  it("mints a token whose payload.sub matches the userId", async () => {
    const userId = "u_jwt_sub_check_1";
    const res = await post({
      appId: "test_app",
      appSecret: APP_SECRET,
      userId,
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const payload = await verify(token, env.JWT_SECRET);
    expect(payload.sub).toBe(userId);
    expect(payload.exp).toBeGreaterThan(payload.iat);
    expect(payload.jti).toMatch(/^[0-9a-f]{32}$/);
  });

  it("inserts the userId into the users table (insert-or-ignore)", async () => {
    const userId = "u_users_insert_check_1";
    const res = await post({
      appId: "test_app",
      appSecret: APP_SECRET,
      userId,
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT id FROM users WHERE id = ?1")
      .bind(userId)
      .first<{ id: string }>();
    expect(row?.id).toBe(userId);
  });

  it("is idempotent on user creation — calling twice does not error", async () => {
    const userId = "u_users_idem_check_1";
    const r1 = await post({
      appId: "test_app",
      appSecret: APP_SECRET,
      userId,
    });
    const r2 = await post({
      appId: "test_app",
      appSecret: APP_SECRET,
      userId,
    });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM users WHERE id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(row?.c).toBe(1);
  });
});

describe("post /v1/auth/token (denylist plumbing)", () => {
  // The full mint→deny→reject flow now lives in `events.route.test.ts` (the
  // "401 token_revoked when the JWT was denied via denyToken" test). It
  // verifies the same plumbing — `denyToken` writes a `jti:<id>` key to CACHE
  // and `requireAuth` reads it on the next protected request — but through
  // the real `/v1/events` route instead of a one-off fixture endpoint. The
  // `it.todo` originally here has been converted; nothing remains stubbed.
  it.skip("moved to events.route.test.ts — see test 'returns 401 token_revoked when the JWT was denied via denyToken'", () => {
    // intentionally empty — placeholder for grep'ability only.
  });
});

describe("post /v1/auth/token (kind claim — Phase 8 / TASK-003)", () => {
  it("omits 'kind' from the JWT payload when body.kind is absent (regular mint path)", async () => {
    const res = await post({
      appId: "test_app",
      appSecret: APP_SECRET,
      userId: "u_kind_omitted_1",
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const payload = await verify(token, env.JWT_SECRET);
    expect((payload as { kind?: unknown }).kind).toBeUndefined();
  });

  it("includes kind:'demo' in the JWT payload when body.kind === 'demo'", async () => {
    const res = await SELF.fetch("https://api.test/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appId: "test_app",
        appSecret: APP_SECRET,
        userId: "demo_user_kind_yes_1",
        kind: "demo",
      }),
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const payload = await verify(token, env.JWT_SECRET);
    expect((payload as { kind?: string }).kind).toBe("demo");
  });

  it("ignores unknown kind values (defence-in-depth — only 'demo' is whitelisted)", async () => {
    const res = await SELF.fetch("https://api.test/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appId: "test_app",
        appSecret: APP_SECRET,
        userId: "u_kind_unknown_1",
        kind: "admin", // not allowed
      }),
    });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    const payload = await verify(token, env.JWT_SECRET);
    expect((payload as { kind?: string }).kind).toBeUndefined();
  });
});
