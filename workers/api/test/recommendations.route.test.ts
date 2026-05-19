/**
 * /v1/recommendations integration tests — TDD-first (TASK-017).
 *
 * Routes under test:
 *   GET /v1/recommendations
 *
 * Auth: JWT Bearer (requireAuth from TASK-007).
 *
 * AI binding: workerd has no local emulator for Workers AI; we declare the
 * binding in `wrangler.test.jsonc` so `env.AI` is defined, then patch
 * `env.AI.run` via `vi.spyOn` BEFORE every call so the remote-proxy session
 * is never actually opened (CI has no CF creds).
 *
 * Mock pattern for env.AI:
 *   const aiSpy = vi.spyOn(env.AI, "run").mockResolvedValue({
 *     response: JSON.stringify({ missionIds: ["mis_a"], reason: "..." }),
 *   });
 *   ... test ...
 *   aiSpy.mockRestore();
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";
import { ensureUser, upsertProgress } from "../src/db/schema";

/**
 * Seed an active mission_progress row for the given user. The route's
 * `loadActiveMissionsForUser` selects rows where status is 'active' or
 * 'completed' — without one of these, the route short-circuits and the AI
 * binding is never invoked. The tests below that DO need an AI call seed an
 * "active" row pointing at a known seed mission id.
 */
async function seedActiveMission(
  userId: string,
  missionId = "mis_ecom_daily_purchase_3",
): Promise<void> {
  await ensureUser(env.DB, userId);
  await upsertProgress(env.DB, {
    userId,
    missionId,
    status: "active",
    progress: 0.33,
    currentCount: 1,
    targetCount: 3,
    updatedAt: Date.now(),
  });
}

const JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec(): number {
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

function getRecommendations(init: { token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch("https://api.test/v1/recommendations", {
    method: "GET",
    headers,
  });
}

interface RecommendationsResp {
  missionIds: string[];
  reason: string;
  cached: boolean;
  count: number;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// -----------------------------------------------------------------------------
// Auth
// -----------------------------------------------------------------------------

describe("/v1/recommendations — auth", () => {
  it("returns 401 when no JWT is provided", async () => {
    const res = await getRecommendations();
    expect(res.status).toBe(401);
  });

  it("returns 401 when a malformed token is provided", async () => {
    const res = await getRecommendations({ token: "not.a.jwt" });
    expect(res.status).toBe(401);
  });
});

// -----------------------------------------------------------------------------
// Happy path
// -----------------------------------------------------------------------------

describe("/v1/recommendations — happy path", () => {
  it("returns 200 with missionIds / reason / cached / count, calling env.AI.run once", async () => {
    const userId = `u_recs_happy_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);
    await seedActiveMission(userId);

    const aiSpy = vi.spyOn(env.AI, "run").mockResolvedValue({
      response: JSON.stringify({
        missionIds: ["mis_ecom_daily_purchase_3"],
        reason: "You’ve been shopping like a champ — keep the streak going.",
      }),
      // pool-workers' Ai.run type is wide; we cast our return.
    } as unknown as Record<string, unknown>);

    const res = await getRecommendations({ token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecommendationsResp;
    expect(body.missionIds).toEqual(["mis_ecom_daily_purchase_3"]);
    expect(body.reason).toContain("You");
    expect(body.cached).toBe(false);
    expect(typeof body.count).toBe("number");
    expect(body.count).toBe(1);

    expect(aiSpy).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// Cache HIT — second call returns cached:true and AI is not called again
// -----------------------------------------------------------------------------

describe("/v1/recommendations — cache HIT", () => {
  it("returns cached:true on the second call (AI invoked only once across both)", async () => {
    const userId = `u_recs_cache_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);
    await seedActiveMission(userId);

    const aiSpy = vi.spyOn(env.AI, "run").mockResolvedValue({
      response: JSON.stringify({
        missionIds: ["mis_ecom_daily_purchase_3"],
        reason: "You’re on a roll — pick this up next.",
      }),
    } as unknown as Record<string, unknown>);

    // First call → cache MISS → AI invoked, response cached.
    const r1 = await getRecommendations({ token });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as RecommendationsResp;
    expect(b1.cached).toBe(false);
    expect(aiSpy).toHaveBeenCalledTimes(1);

    // Second call → cache HIT → AI NOT invoked again.
    const r2 = await getRecommendations({ token });
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as RecommendationsResp;
    expect(b2.cached).toBe(true);
    expect(b2.missionIds).toEqual(b1.missionIds);
    expect(aiSpy).toHaveBeenCalledTimes(1);
  });
});

// -----------------------------------------------------------------------------
// Empty active missions — short-circuit (no AI call)
// -----------------------------------------------------------------------------

describe("/v1/recommendations — empty active-missions short-circuit", () => {
  it("returns { missionIds: [], reason, cached:false, count:0 } without calling env.AI.run", async () => {
    // We use a userId for whom we'll have no active missions. A brand-new user
    // has NO mission_progress rows at all → activeMissions is empty.
    const userId = `u_recs_empty_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    const aiSpy = vi.spyOn(env.AI, "run").mockResolvedValue({
      response: "should not be called",
    } as unknown as Record<string, unknown>);

    const res = await getRecommendations({ token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecommendationsResp;
    expect(body.missionIds).toEqual([]);
    expect(body.count).toBe(0);
    expect(typeof body.reason).toBe("string");

    expect(aiSpy).not.toHaveBeenCalled();
  });
});

// -----------------------------------------------------------------------------
// 502 — AI returns malformed (unparseable) text
// -----------------------------------------------------------------------------

describe("/v1/recommendations — 502 ai_response_malformed", () => {
  it("returns 502 when env.AI.run returns prose with no JSON", async () => {
    const userId = `u_recs_malformed_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);
    await seedActiveMission(userId);

    vi.spyOn(env.AI, "run").mockResolvedValue({
      response: "Sorry, I cannot follow JSON instructions right now.",
    } as unknown as Record<string, unknown>);

    const res = await getRecommendations({ token });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ai_response_malformed");
  });
});

// -----------------------------------------------------------------------------
// 503 — env.AI.run itself rejects (binding outage)
// -----------------------------------------------------------------------------

describe("/v1/recommendations — 503 ai_unavailable", () => {
  it("returns 503 when env.AI.run rejects (binding outage)", async () => {
    const userId = `u_recs_outage_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);
    await seedActiveMission(userId);

    vi.spyOn(env.AI, "run").mockRejectedValue(new Error("ai binding down"));

    const res = await getRecommendations({ token });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("ai_unavailable");
  });
});
