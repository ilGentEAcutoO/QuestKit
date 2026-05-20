/**
 * /v1/demo/reset integration tests — TDD-first (Phase 8 / TASK-003).
 *
 * Mounted route under test:  POST /v1/demo/reset
 * Auth:                       JWT Bearer (requireAuth middleware) + extra
 *                             gate that the JWT must carry `kind: "demo"`
 *                             AND the userId must start with "demo_".
 *
 * Why a dedicated endpoint?
 *
 *   The original DevTools "Reset demo user" button only cleared
 *   localStorage; server-side progress, balances, and events lingered. This
 *   route is the server-side counterpart — it wipes the caller's
 *   `mission_progress`, `balances`, and `events` rows in a single
 *   `db.batch([...])` and additionally clears the per-user KV scratch space
 *   (`idem:${userId}:*` and `rec:${userId}`).
 *
 * Security model:
 *
 *   Two complementary checks short-circuit BEFORE any DB op:
 *     1. JWT payload must include `kind === "demo"`.
 *     2. `userId` (the JWT's `sub`) must start with `demo_`.
 *
 *   Either failing yields 403 (NOT 401 — the token is valid; the user just
 *   isn't permitted to use this dangerous endpoint).
 *
 *   The demo's mint proxy (`apps/demo/src/server/index.ts`) is the only
 *   caller that should set `kind: "demo"`; production tokens minted via the
 *   regular path omit the claim and therefore cannot trip the reset, even
 *   if the userId happens to start with `demo_`.
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";
import { ensureUser, insertEvent, upsertProgress } from "../src/db/schema";

const JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Mint a JWT with optional `kind` claim. The default kind is undefined (i.e.
 * production-shaped token). Pass `kind: "demo"` to simulate a token minted
 * via the demo mint proxy.
 */
async function mintToken(
  userId: string,
  overrides: Partial<JwtPayload> & { kind?: string } = {},
): Promise<{ token: string; jti: string; exp: number }> {
  const iat = nowSec();
  const exp = iat + 3600;
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const payload: JwtPayload & { kind?: string } = {
    sub: userId,
    iat,
    exp,
    jti,
    ...overrides,
  };
  const token = await sign(payload as JwtPayload, JWT_SECRET);
  return { token, jti: payload.jti, exp: payload.exp };
}

function postReset(init: { token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch("https://api.test/v1/demo/reset", {
    method: "POST",
    headers,
  });
}

/** Build a populated user (events + progress + balance + KV scratch). */
async function seedUser(userId: string): Promise<void> {
  await ensureUser(env.DB, userId);
  await upsertProgress(env.DB, {
    userId,
    missionId: "mis_ecom_daily_purchase_3",
    status: "completed",
    progress: 1,
    currentCount: 3,
    targetCount: 3,
    updatedAt: Date.now(),
  });
  await insertEvent(env.DB, {
    id: `evt_${userId}_seed_1`,
    userId,
    name: "purchase.completed",
    payload: { amount: 10 },
    timestamp: Date.now(),
    idempotencyKey: `seed_${userId}_1`,
  });
  // Mint a balance row
  await env.DB.prepare(
    `INSERT INTO balances (user_id, currency, amount, updated_at)
       VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id, currency) DO UPDATE SET
       amount = excluded.amount, updated_at = excluded.updated_at`,
  )
    .bind(userId, "coin", 500, Date.now())
    .run();
  // KV scratch space — idem cache + recommendations cache.
  await env.CACHE.put(`idem:${userId}:k1`, JSON.stringify({ accepted: true }));
  await env.CACHE.put(`idem:${userId}:k2`, JSON.stringify({ accepted: true }));
  await env.CACHE.put(
    `rec:${userId}`,
    JSON.stringify({ missionIds: [], reason: "x" }),
  );
}

// ---------------------------------------------------------------------------
// auth gate
// ---------------------------------------------------------------------------

describe("/v1/demo/reset — auth gate", () => {
  it("returns 401 without a JWT", async () => {
    const res = await postReset();
    expect(res.status).toBe(401);
  });

  it("returns 403 when the JWT lacks kind:'demo'", async () => {
    // userId starts with demo_ but the kind claim is missing — must still
    // refuse. Defence in depth: both checks are AND, not OR.
    const userId = "demo_user_no_kind";
    const { token } = await mintToken(userId);
    const res = await postReset({ token });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_demo_user");
  });

  it("returns 403 when the userId does not start with 'demo_'", async () => {
    // kind:"demo" present but userId is a regular user — refuse.
    const userId = "u_real_customer_1";
    const { token } = await mintToken(userId, { kind: "demo" });
    const res = await postReset({ token });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_demo_user");
  });

  it("does NOT touch DB rows when refused with 403", async () => {
    // The route must short-circuit BEFORE the wipe. We seed data, fire a
    // refused reset, then assert the data is still there.
    const userId = "u_real_customer_seeded_1";
    await seedUser(userId);
    const { token } = await mintToken(userId, { kind: "demo" });
    const res = await postReset({ token });
    expect(res.status).toBe(403);
    const eventCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM events WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(eventCount?.c).toBe(1);
    const progressCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM mission_progress WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(progressCount?.c).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// happy path
// ---------------------------------------------------------------------------

describe("/v1/demo/reset — wipe", () => {
  it("returns 200 + {ok:true} and clears events, progress, balances for the demo user", async () => {
    const userId = "demo_user_wipe_1";
    await seedUser(userId);
    const { token } = await mintToken(userId, { kind: "demo" });

    const res = await postReset({ token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    const eventCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM events WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(eventCount?.c).toBe(0);

    const progressCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM mission_progress WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(progressCount?.c).toBe(0);

    const balanceCount = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM balances WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(balanceCount?.c).toBe(0);
  });

  it("clears idem:<userId>:* and rec:<userId> KV keys", async () => {
    const userId = "demo_user_kv_wipe_1";
    await seedUser(userId);
    // Sanity check that the keys are seeded.
    expect(await env.CACHE.get(`idem:${userId}:k1`)).not.toBeNull();
    expect(await env.CACHE.get(`rec:${userId}`)).not.toBeNull();

    const { token } = await mintToken(userId, { kind: "demo" });
    const res = await postReset({ token });
    expect(res.status).toBe(200);

    expect(await env.CACHE.get(`idem:${userId}:k1`)).toBeNull();
    expect(await env.CACHE.get(`idem:${userId}:k2`)).toBeNull();
    expect(await env.CACHE.get(`rec:${userId}`)).toBeNull();
  });

  it("only affects the caller — a second demo user's data is untouched", async () => {
    const userA = "demo_user_isolation_a";
    const userB = "demo_user_isolation_b";
    await seedUser(userA);
    await seedUser(userB);

    const { token } = await mintToken(userA, { kind: "demo" });
    const res = await postReset({ token });
    expect(res.status).toBe(200);

    // userA is wiped
    const aEvents = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM events WHERE user_id = ?1",
    )
      .bind(userA)
      .first<{ c: number }>();
    expect(aEvents?.c).toBe(0);

    // userB is untouched
    const bEvents = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM events WHERE user_id = ?1",
    )
      .bind(userB)
      .first<{ c: number }>();
    expect(bEvents?.c).toBe(1);
    const bProgress = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM mission_progress WHERE user_id = ?1",
    )
      .bind(userB)
      .first<{ c: number }>();
    expect(bProgress?.c).toBe(1);
    const bBalance = await env.DB.prepare(
      "SELECT amount FROM balances WHERE user_id = ?1 AND currency = ?2",
    )
      .bind(userB, "coin")
      .first<{ amount: number }>();
    expect(bBalance?.amount).toBe(500);

    // userB's KV is also untouched.
    expect(await env.CACHE.get(`idem:${userB}:k1`)).not.toBeNull();
    expect(await env.CACHE.get(`rec:${userB}`)).not.toBeNull();
  });

  it("is idempotent — second call on an already-empty user still returns 200", async () => {
    const userId = "demo_user_idempotent_1";
    await seedUser(userId);
    const { token } = await mintToken(userId, { kind: "demo" });

    const r1 = await postReset({ token });
    expect(r1.status).toBe(200);
    const r2 = await postReset({ token });
    expect(r2.status).toBe(200);
  });
});
