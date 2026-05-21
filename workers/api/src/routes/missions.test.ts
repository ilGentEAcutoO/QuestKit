/**
 * /v1/missions deadlock regression tests (Phase 8 / v0.1.4 TASK-001).
 *
 * Pins: the claim endpoint MUST return promptly even when the SSE_HUB DO is
 * wedged. Before this task the route awaited `tryBroadcastClaim` inline, so a
 * stalled SSE writer (or a hung DO RPC) would hold the response forever.
 *
 * Fix locus: routes/missions.ts swaps `await tryBroadcastClaim(...)` for
 * `c.executionCtx.waitUntil(tryBroadcastClaim(...))` and the broadcast itself
 * arms `AbortSignal.timeout(2000)` on its stub.fetch calls. This test only
 * needs to assert the OUTER behaviour (claim returns fast) — the unit-level
 * deadlock fix lives in `sse-hub.test.ts`.
 *
 * Test infra parity:
 *   We mirror the helpers from `test/missions.route.test.ts` (mintToken etc.)
 *   so this file is self-contained and doesn't entangle with that suite's
 *   setup. Keeping the regression scope tight makes failures unambiguous.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type JwtPayload, sign } from "../auth/jwt";
import { ensureUser, upsertProgress } from "../db/schema";

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

function postClaim(id: string, token: string): Promise<Response> {
  return SELF.fetch(
    `https://api.test/v1/missions/${encodeURIComponent(id)}/claim`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
    },
  );
}

interface ClaimResp {
  progress: { status: string };
  balance: { amount: number } | null;
  reward: unknown;
}

describe("post /v1/missions/:id/claim — SSE deadlock regression (TASK-001)", () => {
  it("returns success in <500ms even if SSE_HUB.fetch never resolves", async () => {
    // Pre-condition: a user with a completed mission ready to claim.
    const userId = "u_claim_deadlock_regression";
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

    // Replace SSE_HUB.get with a stub whose fetch NEVER resolves. This is
    // the worst-case shape of the production bug: a DO RPC that goes out
    // and never comes back. Before TASK-001 the route awaited this fetch
    // and hung indefinitely.
    const realGet = env.SSE_HUB.get.bind(env.SSE_HUB);
    const getSpy = vi.spyOn(env.SSE_HUB, "get").mockImplementation((id) => {
      const real = realGet(id);
      // Wrap the real stub but intercept `fetch` to return a forever-pending
      // promise. The rest of the stub surface (id, name, etc.) passes
      // through so any incidental access doesn't blow up.
      const fakeFetch = (() => {
        return new Promise<Response>(() => {
          // Never resolves, never rejects — the EXACT shape of the bug.
        });
      }) as unknown as DurableObjectStub["fetch"];
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === "fetch") return fakeFetch;
          return Reflect.get(target, prop, receiver);
        },
      });
    });

    const t0 = Date.now();
    const res = await postClaim("mis_ecom_daily_purchase_3", token);
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(200);
    const body = (await res.json()) as ClaimResp;
    expect(body.progress.status).toBe("claimed");
    expect(body.balance?.amount).toBe(100);

    // The hard guarantee. With the broadcast detached via waitUntil,
    // the claim returns as soon as the D1 transaction commits — the DO
    // RPC happens out-of-band and doesn't gate the response.
    // We allow 500ms for D1 + KV roundtrips on workerd; the regressed
    // implementation would hang forever (or until the test timeout).
    expect(elapsed).toBeLessThan(500);

    getSpy.mockRestore();
  });

  it("counters keep advancing (events ingest returns fast) while a stalled SSE writer is registered", async () => {
    // Models the user-facing scenario: Watch tab holds an EventSource open
    // (a writer is registered on the user's SSE hub), and meanwhile other
    // /v1/events POSTs fire (Buy, Spin, Scratch, Check-in). Before the
    // TASK-001 fix, the events pipeline awaited the broadcast which
    // serialised on the stalled writer — every counter froze.
    //
    // After the fix: the broadcast is detached via ctx.waitUntil, so the
    // events POST returns as soon as the rule engine commits. We assert
    // multiple events return promptly even with a stalled subscriber
    // registered on the same user's SSE hub.
    const userId = "u_events_watch_race";
    const { token } = await mintToken(userId);
    await ensureUser(env.DB, userId);

    // Register a stalled subscriber on this user's SSE hub. We use the
    // real DO via `idFromName(userId)` so the events pipeline's
    // `env.SSE_HUB.idFromName(userId)` resolves to the same DO.
    const stubId = env.SSE_HUB.idFromName(userId);
    const stub = env.SSE_HUB.get(stubId);
    const stalledRes = await stub.fetch("https://_/subscribe");
    expect(stalledRes.status).toBe(200);
    // CRITICAL: do not drain the body. The HWM=1 buffer fills with the
    // ": connected" sentinel; subsequent broadcast writes pend forever
    // on backpressure.
    await new Promise((r) => setTimeout(r, 20));

    // Fire 3 events back-to-back. Each must return promptly (no hang).
    const eventsToFire = [
      {
        name: "purchase.completed",
        payload: { amount: 10, category: "books" },
      },
      {
        name: "purchase.completed",
        payload: { amount: 20, category: "games" },
      },
      { name: "purchase.completed", payload: { amount: 30, category: "toys" } },
    ];

    for (const evt of eventsToFire) {
      const t0 = Date.now();
      const res = await SELF.fetch("https://api.test/v1/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId,
          name: evt.name,
          payload: evt.payload,
          timestamp: Date.now(),
        }),
      });
      const elapsed = Date.now() - t0;
      expect(res.status).toBe(200);
      // Each ingest call must return promptly. The broadcast can take up
      // to 2s in the background but that's via ctx.waitUntil — it doesn't
      // gate the response. 1s ceiling absorbs D1 + AE + KV roundtrips.
      expect(elapsed).toBeLessThan(1000);
    }

    // Cleanup: cancel the stalled subscriber's body so its writer can
    // settle. The DO's writers set still has the stale entry; that's fine
    // — the next broadcast will GC it via the writer_timeout path.
    try {
      await stalledRes.body?.cancel();
    } catch {
      // ignore
    }
  });

  // Phase 9 / TASK-001 Cluster C1 — the claim broadcast must deliver
  // THREE distinct SDKUpdate events to a live SSE subscriber:
  //   1. mission.claimed  (terminal status flip — drives card UI)
  //   2. reward.granted   (toast trigger)
  //   3. balance.changed  (currency-reward only — refreshes BalanceBadge)
  //
  // The test registers a healthy (actively-drained) subscriber on the
  // user's SSE hub, fires the claim, and asserts all three frames land
  // within a generous budget. Before TASK-001 only events (2) and (3)
  // were emitted — bug B1 manifested as the card staying at "Claim"
  // because no event flipped the status. This test pins the new
  // contract.
  it("delivers mission.claimed + reward.granted + balance.changed to a live SSE subscriber", async () => {
    const userId = "u_claim_broadcast_smoke";
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

    // Register a healthy subscriber on the user's SSE hub. The DO
    // `idFromName(userId)` resolves to the same instance the claim
    // route's broadcaster targets.
    const stubId = env.SSE_HUB.idFromName(userId);
    const stub = env.SSE_HUB.get(stubId);
    const subRes = await stub.fetch("https://_/subscribe");
    expect(subRes.status).toBe(200);

    // Detached reader loop — keep draining so the DO's writes against
    // this writer resolve immediately (no backpressure). The frames
    // array captures everything that lands.
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

    // Let the initial `: connected` sentinel land before firing the claim.
    await new Promise((r) => setTimeout(r, 20));

    const res = await postClaim("mis_ecom_daily_purchase_3", token);
    expect(res.status).toBe(200);

    // Poll for all three SSE event types — the broadcast is detached via
    // ctx.waitUntil, so the post above can return before the broadcast
    // completes. 3s budget absorbs D1 + the per-broadcast 2s SSE_HUB
    // ceiling on workerd.
    const allThreeDelivered = await Promise.race([
      (async () => {
        while (true) {
          const text = frames.join("");
          const hasClaimed = text.includes('"type":"mission.claimed"');
          const hasReward = text.includes('"type":"reward.granted"');
          const hasBalance = text.includes('"type":"balance.changed"');
          if (hasClaimed && hasReward && hasBalance) return true;
          await new Promise((r) => setTimeout(r, 25));
        }
      })(),
      new Promise<false>((r) => setTimeout(() => r(false), 3000)),
    ]);
    expect(allThreeDelivered).toBe(true);

    // Bonus: pin the ORDERING. mission.claimed MUST appear in the wire
    // before reward.granted so the UI flips the card to disabled before
    // the toast lands. (We collapse all frame text to find the first
    // occurrence of each type marker.)
    const joined = frames.join("");
    const idxClaimed = joined.indexOf('"type":"mission.claimed"');
    const idxReward = joined.indexOf('"type":"reward.granted"');
    expect(idxClaimed).toBeGreaterThanOrEqual(0);
    expect(idxReward).toBeGreaterThanOrEqual(0);
    expect(idxClaimed).toBeLessThan(idxReward);

    // Bonus: the mission.claimed payload must carry the post-claim
    // progress shape (status: "claimed") — that's what flips the card.
    expect(joined).toMatch(
      /"type":"mission\.claimed"[^}]*"data":\{[^}]*"status":"claimed"/,
    );

    // Cleanup the subscriber so the stream settles.
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  });

  it("claim still commits the D1 transaction when SSE_HUB hangs (balance + status are correct)", async () => {
    // Defence-in-depth: the response shape is right, the DB row is also
    // right. A future regression that returns optimistic data without
    // committing would slip past the elapsed-time check above.
    const userId = "u_claim_deadlock_db_check";
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

    const realGet = env.SSE_HUB.get.bind(env.SSE_HUB);
    const getSpy = vi.spyOn(env.SSE_HUB, "get").mockImplementation((id) => {
      const real = realGet(id);
      const fakeFetch = (() => {
        return new Promise<Response>(() => undefined);
      }) as unknown as DurableObjectStub["fetch"];
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === "fetch") return fakeFetch;
          return Reflect.get(target, prop, receiver);
        },
      });
    });

    const res = await postClaim("mis_ecom_daily_purchase_3", token);
    expect(res.status).toBe(200);

    // Verify the D1 side-effects are intact regardless of the broadcast.
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

    getSpy.mockRestore();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
