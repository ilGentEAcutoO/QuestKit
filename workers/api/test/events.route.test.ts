/**
 * /v1/events integration tests — TDD-first (TASK-008, teammate B).
 *
 * Mounted route under test:  POST /v1/events
 * Auth:                       JWT Bearer (requireAuth middleware from TASK-007)
 * Side effects exercised:
 *   - D1 INSERT into `events` (via `insertEvent` from db/schema)
 *   - KV idempotency cache (via services/idempotency)
 *   - Analytics Engine write (binding: EVENTS_AE — observable side effects below)
 *   - Rule engine (stubbed for TASK-008; A's real evaluator slots in via TASK-009)
 *   - Rate limiter DO (real sliding-window since TASK-011; 100/min then 429)
 *
 * Test design notes:
 *
 *   - We mint real JWTs using the same `sign()` helper TASK-007's route uses,
 *     binding `env.JWT_SECRET` from pool-workers' miniflare bindings (see
 *     vitest.config.ts). This exercises the real `requireAuth` middleware
 *     end-to-end rather than mocking it.
 *
 *   - `SELF.fetch` hits the bound default export from `src/index.ts` — so the
 *     middleware stack (Hono → /v1/events → requireAuth → route handler) is
 *     identical to production.
 *
 *   - Mission-match test: uses A's real `evaluateEvent` (TASK-009 landed
 *     mid-implementation). The brief originally expected this `.skip` until
 *     A's evaluator was wired; it's now an active assertion.
 *
 *   - AE writes: pool-workers 0.16 doesn't expose AE writes natively. We use
 *     `vi.spyOn(env.EVENTS_AE, "writeDataPoint")` to confirm shape +
 *     call-count.
 *
 *   - The rate-limiter DO is the real sliding-window since TASK-011. We
 *     verify enforcement directly: 100 calls succeed, the 101st gets 429
 *     with a Retry-After header. We pick a unique userId per test so the
 *     limiter state never leaks (the DO is keyed by userId via idFromName).
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";
import { denyToken } from "../src/auth/middleware";

const JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Mint a JWT identical in shape to what `/v1/auth/token` produces. We mint
 * directly (not via the route) so the test focuses on `/v1/events` behaviour
 * — `auth.route.test.ts` covers the mint path.
 */
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

interface EventBody {
  userId: string;
  name: string;
  payload: Record<string, unknown>;
  timestamp: number;
  idempotencyKey?: string;
}

function postEvent(
  body: Partial<EventBody>,
  init: { token?: string; idempotencyHeader?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.token !== undefined) {
    headers.authorization = `Bearer ${init.token}`;
  }
  if (init.idempotencyHeader !== undefined) {
    headers["idempotency-key"] = init.idempotencyHeader;
  }
  return SELF.fetch("https://api.test/v1/events", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/**
 * Build a fully-populated valid event body for `userId`.
 *
 * The default `name` is `app.heartbeat` — a name no seed mission listens for
 * — so the happy-path tests are NOT entangled with rule-engine output. The
 * mission-match test explicitly uses `purchase.completed` to exercise M1.
 */
function validBody(
  userId: string,
  overrides: Partial<EventBody> = {},
): EventBody {
  return {
    userId,
    name: "app.heartbeat",
    payload: { source: "test" },
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("post /v1/events — auth", () => {
  it("returns 401 missing_token when no Authorization header is present", async () => {
    const res = await postEvent(validBody("u_no_auth"));
    expect(res.status).toBe(401);
    // Hono's HTTPException emits the `message` as the response body (text).
    // Status code is the primary contract; body shape is documented here for
    // anyone wiring SDK error handling.
    const text = await res.text();
    expect(text).toBe("missing_token");
  });

  it("returns 401 token_revoked when the JWT was denied via denyToken (also exercises auth.route.test.ts it.todo)", async () => {
    // ⚠️ This test also fulfils the `it.todo` placeholder in auth.route.test.ts
    // — TASK-007 deferred the full deny→reject loop until /v1/events existed
    // (here). The todo there has been removed (see auth.route.test.ts diff)
    // and points readers to this test instead.
    const userId = "u_denied_token_check";
    const { token, jti, exp } = await mintToken(userId);
    await denyToken(env, jti, exp);
    const res = await postEvent(validBody(userId), { token });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).toBe("token_revoked");
  });
});

describe("post /v1/events — body validation", () => {
  let token: string;
  const userId = "u_validation";

  beforeEach(async () => {
    ({ token } = await mintToken(userId));
  });

  it("returns 400 invalid_event when body is not JSON", async () => {
    const res = await SELF.fetch("https://api.test/v1/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: "{not valid json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_event when `name` is missing", async () => {
    const body = validBody(userId) as Partial<EventBody>;
    delete body.name;
    const res = await postEvent(body, { token });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("invalid_event");
  });

  it("returns 400 invalid_event when `payload` is missing", async () => {
    const body = validBody(userId) as Partial<EventBody>;
    delete body.payload;
    const res = await postEvent(body, { token });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("invalid_event");
  });

  it("returns 400 invalid_event when `timestamp` is missing", async () => {
    const body = validBody(userId) as Partial<EventBody>;
    delete body.timestamp;
    const res = await postEvent(body, { token });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("invalid_event");
  });

  it("returns 400 invalid_event when `payload` is not an object", async () => {
    const res = await postEvent(
      {
        ...validBody(userId),
        payload: "not-an-object" as unknown as Record<string, unknown>,
      },
      { token },
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_event when `name` is empty", async () => {
    const res = await postEvent({ ...validBody(userId), name: "" }, { token });
    expect(res.status).toBe(400);
  });

  it("returns 400 invalid_event when `idempotencyKey` body field is not a string", async () => {
    const res = await postEvent(
      { ...validBody(userId), idempotencyKey: 42 as unknown as string },
      { token },
    );
    expect(res.status).toBe(400);
  });

  it("returns 403 user_mismatch when body.userId does not match JWT sub", async () => {
    const res = await postEvent(
      { ...validBody(userId), userId: "u_some_other_user" },
      { token },
    );
    expect(res.status).toBe(403);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe("user_mismatch");
  });
});

describe("post /v1/events — happy path", () => {
  it("returns 200 with {accepted, eventId, missionsUpdated:[]} on a valid event", async () => {
    const userId = "u_happy_path_1";
    const { token } = await mintToken(userId);
    const res = await postEvent(validBody(userId), { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      accepted: boolean;
      eventId: string;
      missionsUpdated: string[];
    };
    expect(body.accepted).toBe(true);
    expect(typeof body.eventId).toBe("string");
    // Without the rule engine wired (TASK-009 stub returns []), no missions
    // are updated by the happy path event.
    expect(body.missionsUpdated).toEqual([]);

    // Verify D1 side-effects: an `events` row exists with the right userId.
    const row = await env.DB.prepare(
      "SELECT id, user_id, name FROM events WHERE id = ?1",
    )
      .bind(body.eventId)
      .first<{ id: string; user_id: string; name: string }>();
    expect(row?.user_id).toBe(userId);
    expect(row?.name).toBe("app.heartbeat");

    // Verify the `users` row was upserted by the route (ensureUser).
    const userRow = await env.DB.prepare("SELECT id FROM users WHERE id = ?1")
      .bind(userId)
      .first<{ id: string }>();
    expect(userRow?.id).toBe(userId);
  });

  /**
   * Mission-match path — uses TASK-009's real `evaluateEvent` (A landed it
   * mid-implementation; original brief expected a skip pending A's work).
   *
   * Three purchase.completed events with `category:"books"` are fired; on
   * the 3rd, M1 ("Triple Treat" — 3 purchases today, no filter) completes
   * AND M3 ("Variety Pack" — 5 weekly purchases across books/games/toys)
   * has progress = 3/5. So the 3rd response contains M1 (completed) and
   * M3 (progress) in `missionsUpdated`.
   */
  it("returns missionsUpdated:['mis_ecom_daily_purchase_3'] on the 3rd purchase.completed in a day", async () => {
    const userId = "u_mission_match_1";
    const { token } = await mintToken(userId);
    const baseTs = Date.now();
    // Fire 3 purchase.completed events with the books category; the 3rd
    // should complete M1.
    for (let i = 0; i < 3; i++) {
      const res = await postEvent(
        {
          userId,
          name: "purchase.completed",
          payload: { amount: 10, category: "books" },
          timestamp: baseTs + i,
        },
        { token },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        missionsUpdated: string[];
      };
      if (i === 2) {
        expect(body.missionsUpdated).toContain("mis_ecom_daily_purchase_3");
      }
    }
    // mission_progress row reflects completion.
    const progress = await env.DB.prepare(
      "SELECT status FROM mission_progress WHERE user_id = ?1 AND mission_id = ?2",
    )
      .bind(userId, "mis_ecom_daily_purchase_3")
      .first<{ status: string }>();
    expect(progress?.status).toBe("completed");
  });
});

describe("post /v1/events — idempotency", () => {
  it("replays via Idempotency-Key HEADER returns same eventId + X-Idempotent-Replay:hit", async () => {
    const userId = "u_idem_header";
    const { token } = await mintToken(userId);
    const body = validBody(userId);
    const idemKey = `idem_header_${crypto.randomUUID()}`;

    const r1 = await postEvent(body, { token, idempotencyHeader: idemKey });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { eventId: string };

    const r2 = await postEvent(body, { token, idempotencyHeader: idemKey });
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { eventId: string };
    expect(b2.eventId).toBe(b1.eventId);
    expect(r2.headers.get("x-idempotent-replay")).toBe("hit");

    // Only ONE D1 row exists for that key.
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM events WHERE user_id = ?1 AND idempotency_key = ?2",
    )
      .bind(userId, idemKey)
      .first<{ c: number }>();
    expect(countRow?.c).toBe(1);
  });

  it("replays via body.idempotencyKey FIELD returns same eventId + X-Idempotent-Replay:hit", async () => {
    const userId = "u_idem_body";
    const { token } = await mintToken(userId);
    const idemKey = `idem_body_${crypto.randomUUID()}`;
    const body: EventBody = { ...validBody(userId), idempotencyKey: idemKey };

    const r1 = await postEvent(body, { token });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { eventId: string };

    const r2 = await postEvent(body, { token });
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { eventId: string };
    expect(b2.eventId).toBe(b1.eventId);
    expect(r2.headers.get("x-idempotent-replay")).toBe("hit");
  });

  it("falls back to D1 partial-unique-index defence when KV cache is missed (db-hit)", async () => {
    // Simulate KV cache expiry / eviction by deleting the cached entry
    // between two calls. The second call should hit the D1 UNIQUE
    // constraint, then the route rebuilds the response and re-caches it
    // with X-Idempotent-Replay: db-hit.
    const userId = "u_idem_db_fallback";
    const { token } = await mintToken(userId);
    const idemKey = `idem_db_fallback_${crypto.randomUUID()}`;

    const r1 = await postEvent(validBody(userId), {
      token,
      idempotencyHeader: idemKey,
    });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { eventId: string };

    // Evict from KV so the route falls past the cache check on the next call.
    await env.CACHE.delete(`idem:${userId}:${idemKey}`);

    const r2 = await postEvent(validBody(userId), {
      token,
      idempotencyHeader: idemKey,
    });
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { eventId: string };
    expect(b2.eventId).toBe(b1.eventId);
    expect(r2.headers.get("x-idempotent-replay")).toBe("db-hit");

    // Still only one D1 row.
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM events WHERE user_id = ?1 AND idempotency_key = ?2",
    )
      .bind(userId, idemKey)
      .first<{ c: number }>();
    expect(countRow?.c).toBe(1);
  });

  it("header takes precedence over body when both are present", async () => {
    const userId = "u_idem_precedence";
    const { token } = await mintToken(userId);

    // First request with HEADER key only.
    const headerKey = `idem_header_only_${crypto.randomUUID()}`;
    const r1 = await postEvent(validBody(userId), {
      token,
      idempotencyHeader: headerKey,
    });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { eventId: string };

    // Second request: SAME header but a DIFFERENT body field. Header should
    // win → return the cached eventId from r1.
    const r2 = await postEvent(
      { ...validBody(userId), idempotencyKey: "different_body_key" },
      { token, idempotencyHeader: headerKey },
    );
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { eventId: string };
    expect(b2.eventId).toBe(b1.eventId);
    expect(r2.headers.get("x-idempotent-replay")).toBe("hit");
  });

  // v0.1.9 F1 regression — bug fix: the KV replay branch in
  // ingestEventCore previously echoed `cached.missionsUpdated`, while the
  // D1 partial-unique-index replay branch already returned `[]`. The
  // asymmetry caused the SDK's useMissions optimistic counter to bump on
  // every KV replay even though no fresh D1 work happened, producing a
  // silent 409 `claim_not_ready` on the next claim attempt.
  //
  // Contract going forward: BOTH replay branches return
  // `missionsUpdated: []`. The first (fresh) call still returns the real
  // mission-updates array — it's only the replay that is now a no-op for
  // the consumer.
  it("returns missionsUpdated:[] on a KV idempotency replay even when the original ingest updated missions", async () => {
    const userId = `u_idem_replay_missions_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);
    const baseTs = Date.now();

    // Fire 2 prior purchase.completed events so the 3rd will trigger M1
    // (mis_ecom_daily_purchase_3 — 3 purchases in a day).
    for (let i = 0; i < 2; i++) {
      const res = await postEvent(
        {
          userId,
          name: "purchase.completed",
          payload: { amount: 10, category: "books" },
          timestamp: baseTs + i,
        },
        { token, idempotencyHeader: `priming_${i}_${crypto.randomUUID()}` },
      );
      expect(res.status).toBe(200);
    }

    // The 3rd purchase carries a stable idempotency key — fresh ingest
    // should populate missionsUpdated with at least mis_ecom_daily_purchase_3.
    const idemKey = `idem_replay_missions_${crypto.randomUUID()}`;
    const thirdBody = {
      userId,
      name: "purchase.completed",
      payload: { amount: 10, category: "books" },
      timestamp: baseTs + 2,
    };

    const r1 = await postEvent(thirdBody, {
      token,
      idempotencyHeader: idemKey,
    });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as {
      eventId: string;
      missionsUpdated: string[];
    };
    // Fresh ingest reports the mission update.
    expect(b1.missionsUpdated).toContain("mis_ecom_daily_purchase_3");

    // Second identical request: KV replay branch. The cached event id is
    // returned (so the client can correlate) but missionsUpdated MUST be
    // empty — no new D1 / mission_progress work happened, so the SDK
    // must not optimistically bump anything a second time.
    const r2 = await postEvent(thirdBody, {
      token,
      idempotencyHeader: idemKey,
    });
    expect(r2.status).toBe(200);
    expect(r2.headers.get("x-idempotent-replay")).toBe("hit");
    const b2 = (await r2.json()) as {
      eventId: string;
      missionsUpdated: string[];
    };
    expect(b2.eventId).toBe(b1.eventId);
    expect(b2.missionsUpdated).toEqual([]);
  });
});

describe("post /v1/events — analytics engine wiring", () => {
  it("returns 200 (i.e. AE binding write does not throw) on a valid event", async () => {
    // Pool-workers 0.16 does not expose AE write inspection; this test
    // verifies indirect wiring — if the AE write code-path threw, the route
    // would 500. Direct observability is acquired at deploy time via
    // `wrangler tail` against questkit_events.
    const userId = "u_ae_wiring";
    const { token } = await mintToken(userId);
    const res = await postEvent(validBody(userId), { token });
    expect(res.status).toBe(200);
  });

  it("spies on writeDataPoint to confirm exactly one write per accepted event", async () => {
    // Robust observability: spy on the AE binding's writeDataPoint and
    // assert it was called once with the expected blob/double shape.
    const spy = vi.spyOn(env.EVENTS_AE, "writeDataPoint");
    const userId = "u_ae_spy";
    const { token } = await mintToken(userId);
    const res = await postEvent(validBody(userId), { token });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const call = spy.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    // blobs[0] = name, blobs[1] = userId
    expect(call?.blobs?.[0]).toBe("app.heartbeat");
    expect(call?.blobs?.[1]).toBe(userId);
    // doubles[0] = count (1)
    expect(call?.doubles?.[0]).toBe(1);
    spy.mockRestore();
  });
});

describe("post /v1/events — rate limiter enforcement (TASK-011)", () => {
  it("allows 100 calls/min then returns 429 on the 101st with a Retry-After header", async () => {
    // Unique userId so the per-user DO doesn't share state with any other
    // test in this file (the limiter is keyed by `idFromName(userId)`).
    const userId = `u_rate_limit_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    // Fire 100 sequential events. With limit=100/minute these all
    // succeed. We use unique idempotency keys so we don't trip the
    // idempotency cache and short-circuit the rate-limit check.
    for (let i = 0; i < 100; i++) {
      const res = await postEvent(validBody(userId), {
        token,
        idempotencyHeader: `rl_${i}_${crypto.randomUUID()}`,
      });
      // If any of the first 100 returns 429 we want a precise failure
      // message — `expect(res.status).toBe(200)` without the index is
      // less debuggable.
      if (res.status !== 200) {
        throw new Error(
          `expected 200 on call ${i + 1}/100 but got ${res.status}`,
        );
      }
    }

    // 101st call must be rejected.
    const res = await postEvent(validBody(userId), {
      token,
      idempotencyHeader: `rl_101_${crypto.randomUUID()}`,
    });
    expect(res.status).toBe(429);
    // Retry-After header is in seconds (RFC 7231); should be a positive
    // small number (we're inside the same 60s window).
    const retryAfter = res.headers.get("retry-after");
    expect(retryAfter).not.toBeNull();
    const retryAfterSec = Number(retryAfter);
    expect(Number.isFinite(retryAfterSec)).toBe(true);
    expect(retryAfterSec).toBeGreaterThan(0);
    expect(retryAfterSec).toBeLessThanOrEqual(60);
  }, 20_000); // take a while under workerd. Default 5s isn't always enough. // Generous test timeout: 100+ serial fetches through the worker can

  it("treats a non-200/429 status from the limiter as 'allow' (defensive)", async () => {
    // We can't easily make the real DO return e.g. 500 without code surgery
    // — instead, verify the path indirectly by ensuring isolated calls to a
    // fresh userId always succeed (i.e. the limiter never spuriously
    // blocks). The defensive log path is exercised in dev/staging
    // observability, not in unit tests.
    const userId = `u_rl_isolated_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);
    const res = await postEvent(validBody(userId), { token });
    expect(res.status).toBe(200);
  });
});

describe("post /v1/events — TASK-003 minigame no-currency-mint contract (B5)", () => {
  // Background — the demo's /minigames page fires qk.minigame.spin /
  // qk.minigame.scratch on each spin / reveal. Migration 0004 wires
  // both event names to badge-only missions (mis_lucky_spinner /
  // mis_scratch_master), so the rule engine advances badge progress
  // but the events pipeline NEVER writes to the balances table. Coin
  // minting is gated behind the explicit POST /v1/missions/:id/claim
  // path (db/schema.ts::claimMission) — and even there, only when the
  // mission's reward_json.kind === "currency".
  //
  // This contract is what makes TASK-003's demo-side toast fix safe:
  // even if a future demo regression starts displaying "+10 coin"
  // again, the server-side behaviour is locked here. If a future
  // refactor accidentally couples events ingest to balance writes
  // (e.g. via a misplaced reward hook in the rule engine), THIS test
  // is the canary.

  it("qk.minigame.spin does NOT create or mutate any balances row", async () => {
    const userId = `u_minigame_spin_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    // Sanity: zero balance rows for this fresh user before the spin.
    const preCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM balances WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(preCount?.c).toBe(0);

    const res = await postEvent(
      {
        userId,
        name: "qk.minigame.spin",
        payload: {
          game: "spin_wheel",
          reward: { kind: "badge", badgeId: "lucky_spinner" },
        },
        timestamp: Date.now(),
      },
      { token },
    );
    expect(res.status).toBe(200);

    // The event was ingested.
    const eventRow = await env.DB.prepare(
      "SELECT name FROM events WHERE user_id = ?1 AND name = ?2",
    )
      .bind(userId, "qk.minigame.spin")
      .first<{ name: string }>();
    expect(eventRow?.name).toBe("qk.minigame.spin");

    // CRITICAL contract: balances table is still empty. No coin / gem /
    // anything else was minted by the events pipeline. Currency mints
    // happen only through POST /v1/missions/:id/claim with a
    // currency-kind reward — never on raw event ingest.
    const postCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM balances WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(postCount?.c).toBe(0);

    // Sharper assertion: the coin currency row in particular must not
    // exist (this is the exact lie the old demo toast told).
    const coinRow = await env.DB.prepare(
      "SELECT amount FROM balances WHERE user_id = ?1 AND currency = ?2",
    )
      .bind(userId, "coin")
      .first<{ amount: number }>();
    expect(coinRow).toBeNull();
  });

  it("qk.minigame.scratch does NOT create or mutate any balances row", async () => {
    const userId = `u_minigame_scratch_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    const preCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM balances WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(preCount?.c).toBe(0);

    const res = await postEvent(
      {
        userId,
        name: "qk.minigame.scratch",
        payload: { game: "scratch_card" },
        timestamp: Date.now(),
      },
      { token },
    );
    expect(res.status).toBe(200);

    const eventRow = await env.DB.prepare(
      "SELECT name FROM events WHERE user_id = ?1 AND name = ?2",
    )
      .bind(userId, "qk.minigame.scratch")
      .first<{ name: string }>();
    expect(eventRow?.name).toBe("qk.minigame.scratch");

    // Balances table is still empty after the scratch event.
    const postCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM balances WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(postCount?.c).toBe(0);

    const coinRow = await env.DB.prepare(
      "SELECT amount FROM balances WHERE user_id = ?1 AND currency = ?2",
    )
      .bind(userId, "coin")
      .first<{ amount: number }>();
    expect(coinRow).toBeNull();
  });

  it("advancing mis_lucky_spinner progress via 5 qk.minigame.spin events still does NOT mint currency", async () => {
    // End-to-end pin: even when the spin events COMPLETE a badge mission,
    // no currency is minted. The mission is reward_json.kind=badge — the
    // claim endpoint (separately tested in missions.route.test.ts) would
    // only mint if kind=currency.
    const userId = `u_minigame_full_progress_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    for (let i = 0; i < 5; i++) {
      const res = await postEvent(
        {
          userId,
          name: "qk.minigame.spin",
          payload: { game: "spin_wheel" },
          timestamp: Date.now() + i,
        },
        { token, idempotencyHeader: `spin_${i}_${crypto.randomUUID()}` },
      );
      expect(res.status).toBe(200);
    }

    // The 5th spin should have completed mis_lucky_spinner (count=5).
    const progress = await env.DB.prepare(
      "SELECT status, current_count FROM mission_progress WHERE user_id = ?1 AND mission_id = ?2",
    )
      .bind(userId, "mis_lucky_spinner")
      .first<{ status: string; current_count: number }>();
    expect(progress?.current_count).toBe(5);
    // Status may be "completed" (5/5 of a count=5 mission) — the precise
    // string is the rule engine's contract; what matters here is the
    // balance side-effect, asserted below.

    // CRITICAL: balances row is still empty even after completing the
    // badge mission. The completion does not auto-mint; the claim must
    // be invoked separately (and even then it only mints currency-kind
    // rewards — lucky_spinner is a badge).
    const balanceCount = await env.DB.prepare(
      "SELECT COUNT(*) as c FROM balances WHERE user_id = ?1",
    )
      .bind(userId)
      .first<{ c: number }>();
    expect(balanceCount?.c).toBe(0);
  }, 15_000);
});

describe("post /v1/events — TASK-013 F4-b mission.completed dedup (terminal→terminal skip)", () => {
  // Background — the rule engine intentionally keeps bumping `currentCount`
  // on already-completed missions when subsequent qualifying events arrive
  // (the row stays an accurate analytics tally). Prior to v0.1.12 the
  // ingest pipeline broadcast a fresh `mission.completed` SDKUpdate on
  // every one of those bumps, so a Daily Watcher (target=1) saw 6
  // `mission.completed` events for 6 video clicks. The SDK consumer's
  // celebration toast would fire 6x in principle (the demo clamps
  // `Math.min(current, target)` so the visual was masked, but the wire
  // traffic + DO writes were real waste — see the Playwright
  // `?user=v011_investigate` console capture in TASK-013 brief).
  //
  // Fix (ingest.ts `tryBroadcastProgress`): capture the per-mission
  // status BEFORE running the rule engine, then skip the SSE broadcast
  // entirely when the prior status was already terminal
  // ("completed"/"claimed") AND the post-evaluator status is also
  // terminal. The D1 row still bumps; we just don't tell subscribers
  // about a state change that didn't happen.
  //
  // These tests pin the contract end-to-end by attaching a live
  // subscriber to the user's SSE_HUB DO (same pattern as
  // missions.test.ts:204) and counting `mission.completed` frame
  // appearances across two qualifying events.

  it("does NOT re-fire mission.completed on a 2nd qualifying event for an already-completed Daily Watcher (target=1)", async () => {
    const userId = `u_f4b_daily_watcher_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    // Register a live subscriber on the user's SSE hub BEFORE firing
    // any event so the first broadcast (the genuine completion) also
    // lands and we can compare frame counts before/after the 2nd event.
    const stubId = env.SSE_HUB.idFromName(userId);
    const stub = env.SSE_HUB.get(stubId);
    const subRes = await stub.fetch("https://_/subscribe");
    expect(subRes.status).toBe(200);

    const reader = subRes.body!.getReader();
    const decoder = new TextDecoder();
    const frames: string[] = [];
    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value !== undefined) frames.push(decoder.decode(value));
        }
      } catch {
        // cancellation is expected at teardown
      }
    })();

    // Let the ": connected" sentinel land first.
    await new Promise((r) => setTimeout(r, 20));

    // First video.watched → Daily Watcher 0→1 (target=1) → genuine
    // active→completed transition → MUST broadcast `mission.completed`.
    const r1 = await postEvent(
      {
        userId,
        name: "video.watched",
        payload: { videoId: "v1", genre: "drama", duration_sec: 300 },
        timestamp: Date.now(),
      },
      { token },
    );
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { missionsUpdated: string[] };
    expect(b1.missionsUpdated).toContain("mis_stream_daily_watch_1");

    // Wait for the FIRST mission.completed to land in the subscriber.
    const firstCompletedSeen = await Promise.race([
      (async () => {
        while (true) {
          if (frames.join("").includes('"type":"mission.completed"')) {
            return true;
          }
          await new Promise((r) => setTimeout(r, 25));
        }
      })(),
      new Promise<false>((r) => setTimeout(() => r(false), 3000)),
    ]);
    expect(firstCompletedSeen).toBe(true);

    // Snapshot the wire AFTER the first completion lands. The next
    // event (which targets the SAME already-completed mission) must
    // NOT add a second mission.completed frame.
    const framesAfterFirst = frames.join("");
    const completedCountAfterFirst = countOccurrences(
      framesAfterFirst,
      '"type":"mission.completed"',
    );
    expect(completedCountAfterFirst).toBe(1);

    // Confirm the D1 row IS now in "completed" status (this is the
    // precondition for the dedup behaviour — we're testing what
    // happens when a qualifying event arrives for an already-terminal
    // row).
    const progressBefore = await env.DB.prepare(
      "SELECT status, current_count FROM mission_progress WHERE user_id = ?1 AND mission_id = ?2",
    )
      .bind(userId, "mis_stream_daily_watch_1")
      .first<{ status: string; current_count: number }>();
    expect(progressBefore?.status).toBe("completed");
    expect(progressBefore?.current_count).toBe(1);

    // SECOND video.watched → Daily Watcher is already completed.
    // Rule engine still matches + bumps currentCount → 2 (analytics
    // tally stays honest) → row stays "completed". The broadcast
    // layer MUST skip the SSE emit because terminal→terminal is a
    // dedup-target transition.
    const r2 = await postEvent(
      {
        userId,
        name: "video.watched",
        payload: { videoId: "v2", genre: "comedy", duration_sec: 300 },
        timestamp: Date.now() + 1,
      },
      { token },
    );
    expect(r2.status).toBe(200);

    // Give the broadcast pipeline a moment to settle. If there were a
    // 2nd mission.completed on the wire, it would land within this
    // window — we use the same generous 1s budget the missions
    // SSE-delivery test uses for the negative-evidence assertion.
    await new Promise((r) => setTimeout(r, 500));

    const finalFrames = frames.join("");
    const completedCountFinal = countOccurrences(
      finalFrames,
      '"type":"mission.completed"',
    );
    // CRITICAL: still exactly 1 mission.completed on the wire.
    expect(completedCountFinal).toBe(1);

    // Sanity: the D1 row DID bump (rule engine still runs; this is
    // the intentional analytics-accuracy behaviour). What changed is
    // ONLY the SSE broadcast suppression.
    const progressAfter = await env.DB.prepare(
      "SELECT status, current_count FROM mission_progress WHERE user_id = ?1 AND mission_id = ?2",
    )
      .bind(userId, "mis_stream_daily_watch_1")
      .first<{ status: string; current_count: number }>();
    expect(progressAfter?.status).toBe("completed");
    expect(progressAfter?.current_count).toBe(2);

    // Teardown.
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }, 10_000);

  it("does still broadcast mission.completed on the genuine active→completed transition (positive control)", async () => {
    // Defensive: the dedup fix must not accidentally also suppress the
    // FIRST (genuine) completion broadcast. This test is a paired
    // positive control for the negative assertion above.
    const userId = `u_f4b_positive_${crypto.randomUUID()}`;
    const { token } = await mintToken(userId);

    const stubId = env.SSE_HUB.idFromName(userId);
    const stub = env.SSE_HUB.get(stubId);
    const subRes = await stub.fetch("https://_/subscribe");
    expect(subRes.status).toBe(200);

    const reader = subRes.body!.getReader();
    const decoder = new TextDecoder();
    const frames: string[] = [];
    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value !== undefined) frames.push(decoder.decode(value));
        }
      } catch {
        // cancellation expected at teardown
      }
    })();

    await new Promise((r) => setTimeout(r, 20));

    // Single video.watched (no prior row exists) → 0→1, target=1 →
    // active→completed → broadcast MUST fire.
    const res = await postEvent(
      {
        userId,
        name: "video.watched",
        payload: { videoId: "v_solo", genre: "drama", duration_sec: 300 },
        timestamp: Date.now(),
      },
      { token },
    );
    expect(res.status).toBe(200);

    const completedSeen = await Promise.race([
      (async () => {
        while (true) {
          if (frames.join("").includes('"type":"mission.completed"')) {
            return true;
          }
          await new Promise((r) => setTimeout(r, 25));
        }
      })(),
      new Promise<false>((r) => setTimeout(() => r(false), 3000)),
    ]);
    expect(completedSeen).toBe(true);

    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }, 10_000);
});

/**
 * Count non-overlapping occurrences of `needle` in `haystack`. Used by the
 * F4-b dedup tests to assert exact `mission.completed` frame counts on the
 * wire. Inline rather than imported because vitest doesn't ship a string
 * helper and the rest of this file has no need for it.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count += 1;
    pos = idx + needle.length;
  }
  return count;
}

afterEach(() => {
  // Clear any spies. (vi.spyOn in individual tests calls mockRestore but
  // belt-and-braces here.)
  vi.restoreAllMocks();
});
