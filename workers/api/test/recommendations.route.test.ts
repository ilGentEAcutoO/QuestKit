/**
 * /v1/recommendations integration tests — TDD-first (TASK-017).
 *
 * Routes under test:
 *   GET /v1/recommendations
 *
 * Auth: JWT Bearer (requireAuth from TASK-007).
 *
 * ## Why this file only covers auth + empty-short-circuit
 *
 * Workers AI has NO local emulator. If `wrangler.test.jsonc` declares
 * `"ai": { "binding": "AI" }`, pool-workers opens a remote-proxy session at
 * startup; in CI that requires a Cloudflare login that doesn't exist, so the
 * worker can't even start. Removing the binding (the current state) means
 * `env.AI` is undefined inside the worker.
 *
 * That leaves three testable cases at this layer:
 *   1. 401 — no JWT (requireAuth rejects before any AI call)
 *   2. 401 — malformed JWT (same)
 *   3. 200 — empty active-missions short-circuit (route returns before
 *      touching env.AI)
 *
 * The remaining route behaviors (happy / cache / 502 malformed / 503 outage)
 * all hit `env.AI` via the service. `vi.mock()` cannot reach into the
 * workerd isolate where the route's bundled code lives, so those paths are
 * covered exclusively by `test/ai.service.test.ts`, which constructs a
 * hand-rolled `Pick<Env, "AI" | "CACHE">` stub and tests
 * `recommendMissions` end-to-end. The route is a thin shell around that
 * function — its branches are: load → short-circuit-or-call → translate
 * thrown error to HTTP status. The translation logic is small enough that
 * its inversion-of-control is covered by inspection.
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";

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

// -----------------------------------------------------------------------------
// Auth — requireAuth rejects before any AI binding is touched
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
// Empty active missions — the route short-circuits before calling AI, so this
// case works even when env.AI is undefined.
// -----------------------------------------------------------------------------

describe("/v1/recommendations — empty active-missions short-circuit", () => {
  it("returns { missionIds: [], count: 0, cached: false } without calling AI", async () => {
    // Brand-new userId → no mission_progress rows → activeMissions is empty.
    const userId = `u_recs_empty_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    const res = await getRecommendations({ token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as RecommendationsResp;
    expect(body.missionIds).toEqual([]);
    expect(body.count).toBe(0);
    expect(body.cached).toBe(false);
    expect(typeof body.reason).toBe("string");
  });

  it("reads env.DB (sanity: the worker is up and JWT auth flowed through)", async () => {
    // Trivial guard: the previous test already proves the worker started and
    // requireAuth succeeded, but this version is explicit about the D1
    // dependency working.
    expect(env.DB).toBeDefined();
  });
});
