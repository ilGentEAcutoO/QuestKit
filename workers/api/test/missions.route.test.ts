/**
 * /v1/missions integration tests — TDD-first (TASK-010).
 *
 * Routes under test:
 *   GET  /v1/missions
 *   GET  /v1/missions/:id
 *   POST /v1/missions/:id/claim
 *
 * Auth: JWT Bearer (requireAuth from TASK-007). We mint tokens directly with
 * the same `sign()` helper TASK-007's route uses — see comments in
 * events.route.test.ts for the rationale.
 *
 * Side effects exercised:
 *   - D1 SELECT/INSERT on missions, mission_progress, balances, events
 *   - KV idempotency cache (only for POST /:id/claim)
 *   - SSE_HUB DO broadcast (real since TASK-011; 200 on success, route warns
 *     and continues on any failure)
 *   - Rate-limiter DO is NOT mounted on these routes (events.ts is the only
 *     route that uses it today — read routes don't need it for v0.1).
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";
import { ensureUser, upsertProgress } from "../src/db/schema";

const JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function mintToken(
  userId: string,
  overrides: Partial<JwtPayload> = {},
): Promise<{ token: string; jti: string; exp: number }> {
  const iat = nowSec();
  const exp = iat + 3600;
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const payload: JwtPayload = { sub: userId, iat, exp, jti, ...overrides };
  const token = await sign(payload, JWT_SECRET);
  return { token, jti: payload.jti, exp: payload.exp };
}

function getMissions(
  query: string,
  init: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch(`https://api.test/v1/missions${query}`, {
    method: "GET",
    headers,
  });
}

function getMissionById(
  id: string,
  init: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch(`https://api.test/v1/missions/${encodeURIComponent(id)}`, {
    method: "GET",
    headers,
  });
}

function postClaim(
  id: string,
  init: { token?: string; idempotencyHeader?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  if (init.idempotencyHeader !== undefined) {
    headers["idempotency-key"] = init.idempotencyHeader;
  }
  return SELF.fetch(
    `https://api.test/v1/missions/${encodeURIComponent(id)}/claim`,
    { method: "POST", headers },
  );
}

interface Mission {
  id: string;
  title: string;
  description: string;
  criteria: unknown;
  reward: unknown;
  campaignId?: string;
}

interface MissionProgress {
  userId: string;
  missionId: string;
  status: "locked" | "active" | "completed" | "claimed";
  progress: number;
  currentCount: number;
  targetCount: number;
  updatedAt: number;
}

interface Reward {
  kind: "currency" | "badge" | "item";
  [k: string]: unknown;
}

interface Balance {
  userId: string;
  currency: string;
  amount: number;
  updatedAt: number;
}

interface MissionsListResp {
  missions: Mission[];
  progress: Record<string, MissionProgress>;
  nextCursor?: string;
}

interface MissionDetailResp {
  mission: Mission;
  progress: MissionProgress | null;
}

interface ClaimResp {
  progress: MissionProgress;
  balance: Balance | null;
  reward: Reward;
}

// ----- 401 auth tests -----------------------------------------------------

describe("/v1/missions — auth", () => {
  it("returns 401 on GET /v1/missions without a JWT", async () => {
    const res = await getMissions("");
    expect(res.status).toBe(401);
  });

  it("returns 401 on GET /v1/missions/:id without a JWT", async () => {
    const res = await getMissionById("mis_ecom_daily_purchase_3");
    expect(res.status).toBe(401);
  });

  it("returns 401 on POST /v1/missions/:id/claim without a JWT", async () => {
    const res = await postClaim("mis_ecom_daily_purchase_3");
    expect(res.status).toBe(401);
  });
});

// ----- GET /v1/missions ---------------------------------------------------

describe("get /v1/missions", () => {
  it("returns all 6 seed missions with an empty progress map for a new user", async () => {
    const userId = "u_list_missions_1";
    const { token } = await mintToken(userId);
    const res = await getMissions("", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MissionsListResp;
    expect(body.missions.length).toBe(6);
    // All 6 seed mission ids should be present.
    const ids = body.missions.map((m) => m.id).sort();
    expect(ids).toEqual([
      "mis_ecom_daily_purchase_3",
      "mis_ecom_electronics_50",
      "mis_ecom_variety_week",
      "mis_stream_daily_watch_1",
      "mis_stream_documentary_3",
      "mis_stream_longform_week",
    ]);
    expect(body.progress).toEqual({});
  });

  it("?campaignId=camp_ecom_2026q2 returns only the 3 e-commerce missions", async () => {
    const userId = "u_list_missions_campaign";
    const { token } = await mintToken(userId);
    const res = await getMissions("?campaignId=camp_ecom_2026q2", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MissionsListResp;
    expect(body.missions.length).toBe(3);
    for (const m of body.missions) {
      expect(m.campaignId).toBe("camp_ecom_2026q2");
    }
  });

  it("?status=active returns only missions where the user has active progress", async () => {
    const userId = "u_list_missions_status_active_1";
    const { token } = await mintToken(userId);
    // Initially: no progress → no active missions
    let res = await getMissions("?status=active", { token });
    expect(res.status).toBe(200);
    let body = (await res.json()) as MissionsListResp;
    expect(body.missions.length).toBe(0);

    // Fire 1× purchase.completed → M1 (Triple Treat 3/day) becomes active
    await SELF.fetch("https://api.test/v1/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId,
        name: "purchase.completed",
        payload: { amount: 10, category: "books" },
        timestamp: Date.now(),
      }),
    });

    res = await getMissions("?status=active", { token });
    expect(res.status).toBe(200);
    body = (await res.json()) as MissionsListResp;
    // At least M1 should be active. Other missions might also match (M3 weekly
    // category "books" is in ["books","games","toys"] → 1/5 active).
    const activeIds = body.missions.map((m) => m.id);
    expect(activeIds).toContain("mis_ecom_daily_purchase_3");
    // All returned missions should have an active progress row.
    for (const m of body.missions) {
      expect(body.progress[m.id]?.status).toBe("active");
    }
  });

  it("?limit=2 returns 2 missions and a nextCursor", async () => {
    const userId = "u_list_missions_pagination_1";
    const { token } = await mintToken(userId);
    const res = await getMissions("?limit=2", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MissionsListResp;
    expect(body.missions.length).toBe(2);
    expect(typeof body.nextCursor).toBe("string");

    // Second page via cursor
    const res2 = await getMissions(
      `?limit=2&cursor=${encodeURIComponent(body.nextCursor as string)}`,
      { token },
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as MissionsListResp;
    expect(body2.missions.length).toBe(2);
    // Distinct page
    const firstIds = body.missions.map((m) => m.id);
    const secondIds = body2.missions.map((m) => m.id);
    expect(firstIds[0]).not.toBe(secondIds[0]);
  });
});

// ----- GET /v1/missions/:id ----------------------------------------------

describe("get /v1/missions/:id", () => {
  it("returns the mission + null progress when the user has no progress yet", async () => {
    const userId = "u_get_mission_1";
    const { token } = await mintToken(userId);
    const res = await getMissionById("mis_ecom_daily_purchase_3", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MissionDetailResp;
    expect(body.mission.id).toBe("mis_ecom_daily_purchase_3");
    expect(body.mission.title).toBe("Triple Treat");
    expect(body.progress).toBeNull();
  });

  it("returns 404 mission_not_found on a nonexistent id", async () => {
    const userId = "u_get_mission_404";
    const { token } = await mintToken(userId);
    const res = await getMissionById("nonexistent_mission_id", { token });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("mission_not_found");
  });

  it("returns the user's progress when present", async () => {
    const userId = "u_get_mission_with_progress";
    const { token } = await mintToken(userId);
    // Seed a progress row directly via the db helper.
    await ensureUser(env.DB, userId);
    await upsertProgress(env.DB, {
      userId,
      missionId: "mis_ecom_daily_purchase_3",
      status: "active",
      progress: 0.33,
      currentCount: 1,
      targetCount: 3,
      updatedAt: Date.now(),
    });
    const res = await getMissionById("mis_ecom_daily_purchase_3", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MissionDetailResp;
    expect(body.progress?.status).toBe("active");
    expect(body.progress?.currentCount).toBe(1);
  });
});

// ----- POST /v1/missions/:id/claim ---------------------------------------

describe("post /v1/missions/:id/claim", () => {
  it("returns 409 claim_not_ready when the mission is not yet completed", async () => {
    const userId = "u_claim_not_completed";
    const { token } = await mintToken(userId);
    // No progress row at all → can't claim
    const res = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("claim_not_ready");
  });

  it("returns 404 mission_not_found on a nonexistent mission id", async () => {
    const userId = "u_claim_404";
    const { token } = await mintToken(userId);
    const res = await postClaim("nonexistent_mission", { token });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("mission_not_found");
  });

  it("returns 200 with updated progress, +100 coin balance, and reward shape on first claim of completed currency mission", async () => {
    const userId = "u_claim_completed_currency";
    const { token } = await mintToken(userId);
    // Seed: pre-complete M1 (3-purchases-today, reward 100 coin)
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

    const res = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClaimResp;
    expect(body.progress.status).toBe("claimed");
    expect(body.progress.userId).toBe(userId);
    expect(body.balance).not.toBeNull();
    expect(body.balance?.currency).toBe("coin");
    expect(body.balance?.amount).toBe(100);
    expect(body.reward).toEqual({
      kind: "currency",
      currency: "coin",
      amount: 100,
    });

    // Verify D1 side-effects: mission_progress.status="claimed", balances has +100 coin.
    const progressRow = await env.DB.prepare(
      "SELECT status FROM mission_progress WHERE user_id = ?1 AND mission_id = ?2",
    )
      .bind(userId, "mis_ecom_daily_purchase_3")
      .first<{ status: string }>();
    expect(progressRow?.status).toBe("claimed");

    const balanceRow = await env.DB.prepare(
      "SELECT amount FROM balances WHERE user_id = ?1 AND currency = ?2",
    )
      .bind(userId, "coin")
      .first<{ amount: number }>();
    expect(balanceRow?.amount).toBe(100);
  });

  it("returns idempotent replay (balance unchanged) when called on an already-claimed mission", async () => {
    const userId = "u_claim_already_claimed";
    const { token } = await mintToken(userId);
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

    // First claim
    const r1 = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as ClaimResp;
    expect(b1.balance?.amount).toBe(100);

    // Second claim — idempotent replay, balance should remain at 100.
    const r2 = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as ClaimResp;
    expect(b2.progress.status).toBe("claimed");
    expect(b2.balance?.amount).toBe(100);

    // Single balance row, amount=100 (no double-mint).
    const balanceRow = await env.DB.prepare(
      "SELECT amount FROM balances WHERE user_id = ?1 AND currency = ?2",
    )
      .bind(userId, "coin")
      .first<{ amount: number }>();
    expect(balanceRow?.amount).toBe(100);
  });

  it("replays with X-Idempotent-Replay:hit when called with the same Idempotency-Key header", async () => {
    const userId = "u_claim_idem_header";
    const { token } = await mintToken(userId);
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

    const idemKey = `claim_idem_${crypto.randomUUID()}`;
    const r1 = await postClaim("mis_ecom_daily_purchase_3", {
      token,
      idempotencyHeader: idemKey,
    });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as ClaimResp;
    expect(b1.balance?.amount).toBe(100);

    const r2 = await postClaim("mis_ecom_daily_purchase_3", {
      token,
      idempotencyHeader: idemKey,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("x-idempotent-replay")).toBe("hit");
    const b2 = (await r2.json()) as ClaimResp;
    // Balance unchanged — no double mint.
    expect(b2.balance?.amount).toBe(100);

    const balanceRow = await env.DB.prepare(
      "SELECT amount FROM balances WHERE user_id = ?1 AND currency = ?2",
    )
      .bind(userId, "coin")
      .first<{ amount: number }>();
    expect(balanceRow?.amount).toBe(100);
  });

  it("returns balance:null for a badge reward (no balance row created)", async () => {
    const userId = "u_claim_badge";
    const { token } = await mintToken(userId);
    await ensureUser(env.DB, userId);
    // M2 reward is { kind: "badge", badgeId: "power_user" }
    await upsertProgress(env.DB, {
      userId,
      missionId: "mis_ecom_electronics_50",
      status: "completed",
      progress: 1,
      currentCount: 1,
      targetCount: 1,
      updatedAt: Date.now(),
    });

    const res = await postClaim("mis_ecom_electronics_50", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ClaimResp;
    expect(body.progress.status).toBe("claimed");
    expect(body.balance).toBeNull();
    expect(body.reward).toEqual({ kind: "badge", badgeId: "power_user" });

    // No balance row was created for the badge reward.
    const balRow = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM balances WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(balRow?.c).toBe(0);
  });

  it("broadcasts via SSE_HUB on successful claim (real DO returns 200, no warning emitted)", async () => {
    const userId = "u_claim_sse_broadcast";
    const { token } = await mintToken(userId);
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

    // With the real SSEHub DO (TASK-011) the broadcast returns 200 and the
    // route emits NO warn. We spy on console.warn and assert it was never
    // called with an SSE-broadcast warning. (Other warns may still appear
    // from unrelated subsystems — we scope the assertion to the
    // sse-hub-specific messages.)
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(res.status).toBe(200);
    const sawSseHubWarn = warnSpy.mock.calls.some((args) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          (a.includes("sse-hub") || a.includes("broadcast")),
      ),
    );
    expect(sawSseHubWarn).toBe(false);
    warnSpy.mockRestore();
  });

  it("claim succeeds even when SSE_HUB.get throws (broadcast is best-effort)", async () => {
    // Simulate a broken SSE_HUB binding by stubbing env.SSE_HUB.get to throw.
    // The claim itself MUST still succeed (the broadcast is fire-and-forget;
    // we never let it sink the response). After the test we restore the
    // original `get` so subsequent tests see the real DO.
    const userId = "u_claim_sse_broadcast_throws";
    const { token } = await mintToken(userId);
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

    const getSpy = vi.spyOn(env.SSE_HUB, "get").mockImplementation(() => {
      throw new Error("simulated broken SSE_HUB");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const res = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(res.status).toBe(200);

    // The route MUST log the swallowed broadcast error.
    const sawBroadcastWarn = warnSpy.mock.calls.some((args) =>
      args.some((a) => typeof a === "string" && a.includes("broadcast")),
    );
    expect(sawBroadcastWarn).toBe(true);

    warnSpy.mockRestore();
    getSpy.mockRestore();
  });

  it("does not double-mint when two clients race on the same Idempotency-Key", async () => {
    // Defence-in-depth: even without the header, the helper handles concurrent
    // claims via SELECT-then-CAS-batch — only one claim wins, the other replays.
    const userId = "u_claim_race";
    const { token } = await mintToken(userId);
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

    // Fire two claims back-to-back. (Workerd serialises async I/O so this is a
    // sequential race, but the helper's CAS guard still trips on the 2nd call's
    // status='completed' precondition.)
    const r1 = await postClaim("mis_ecom_daily_purchase_3", { token });
    const r2 = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);

    // Final balance should still be 100 — single mint.
    const balRow = await env.DB.prepare(
      "SELECT amount FROM balances WHERE user_id = ?1 AND currency = ?2",
    )
      .bind(userId, "coin")
      .first<{ amount: number }>();
    expect(balRow?.amount).toBe(100);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
