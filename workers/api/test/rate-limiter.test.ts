/**
 * Durable Object unit tests for `RateLimiter` (TASK-011).
 *
 * Strategy:
 *
 *   We drive the DO via `runInDurableObject` from `cloudflare:test`, which
 *   lets us invoke methods on the live DO instance inside its own isolate.
 *   This is faster than going through HTTP for every assertion and exposes
 *   the typed `check(limit, windowMs)` directly.
 *
 *   For the "window slides" test, the brief notes that vi.useFakeTimers()
 *   doesn't reliably propagate into the DO's `Date.now()` (different
 *   runtime context). Our workaround: use the `windowMs` parameter as the
 *   time-travel knob. A very short window (e.g. 50ms) lets real wall-clock
 *   advance past the boundary in a regular `await new Promise(r =>
 *   setTimeout(r, ...))`. This is deterministic enough on workerd because:
 *     - the limiter uses Date.now() consistently for both INSERT.ts and
 *       SELECT WHERE ts >= windowStart, so a real sleep advances both;
 *     - we sleep ~3x the window so jitter never makes the test flaky.
 *
 * For each test we create a fresh DO id (random unique id) so state never
 * leaks between cases. The DO storage IS persisted between calls inside a
 * single test file unless we abort all DOs - we don't bother with that and
 * just use isolated ids.
 */
import type { RateLimiter } from "../src/durable/rate-limiter";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/** Fresh DO stub with a random id. Each test gets its own clean SQLite. */
function freshStub() {
  const id = env.RATE_LIMITER.newUniqueId();
  return env.RATE_LIMITER.get(id);
}

describe("rate-limiter DO — check() sliding window", () => {
  it("allows up to `limit` hits in the window", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (instance: RateLimiter) => {
      for (let i = 0; i < 5; i++) {
        const r = instance.check(5, 60_000);
        expect(r.ok).toBe(true);
        // `remaining` counts the budget AFTER this hit is recorded.
        expect(r.remaining).toBe(5 - i - 1);
      }
    });
  });

  it("rejects the (limit+1)th hit with a positive retryAfterMs", async () => {
    const stub = freshStub();
    await runInDurableObject(stub, async (instance: RateLimiter) => {
      for (let i = 0; i < 5; i++) {
        const r = instance.check(5, 60_000);
        expect(r.ok).toBe(true);
      }
      const rejected = instance.check(5, 60_000);
      expect(rejected.ok).toBe(false);
      expect(rejected.remaining).toBe(0);
      expect(rejected.retryAfterMs).toBeDefined();
      expect(rejected.retryAfterMs!).toBeGreaterThan(0);
      // Should be <= the window since we're inside it.
      expect(rejected.retryAfterMs!).toBeLessThanOrEqual(60_000);
    });
  });

  it("returns 200 on /check allow and 429 on /check reject with Retry-After header", async () => {
    const stub = freshStub();
    // 200 OK — fresh limiter.
    const r1 = await stub.fetch("https://_/check?limit=3&window=60000");
    expect(r1.status).toBe(200);
    const body1 = (await r1.json()) as { ok: boolean; remaining: number };
    expect(body1.ok).toBe(true);
    expect(body1.remaining).toBe(2);

    // Burn 2 more, then the 4th should 429.
    const r2 = await stub.fetch("https://_/check?limit=3&window=60000");
    expect(r2.status).toBe(200);
    const r3 = await stub.fetch("https://_/check?limit=3&window=60000");
    expect(r3.status).toBe(200);

    const r4 = await stub.fetch("https://_/check?limit=3&window=60000");
    expect(r4.status).toBe(429);
    // RFC 7231: Retry-After in seconds, integer.
    const ra = r4.headers.get("retry-after");
    expect(ra).not.toBeNull();
    const raSec = Number(ra);
    expect(Number.isFinite(raSec)).toBe(true);
    expect(raSec).toBeGreaterThan(0);
    expect(r4.headers.get("content-type")).toBe("application/json");
    const body4 = (await r4.json()) as { ok: boolean; retryAfterMs: number };
    expect(body4.ok).toBe(false);
    expect(body4.retryAfterMs).toBeGreaterThan(0);
  });

  it("returns 404 for paths other than /check", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/wat");
    expect(res.status).toBe(404);
  });

  it("falls back to defaults (100/60s) when query params are missing", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/check");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; remaining: number };
    expect(body.ok).toBe(true);
    expect(body.remaining).toBe(99);
  });

  it("falls back to defaults when params are non-numeric", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/check?limit=NaN&window=NaN");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; remaining: number };
    expect(body.ok).toBe(true);
    // Fallback to default 100 → remaining 99 on first hit.
    expect(body.remaining).toBe(99);
  });
});

describe("rate-limiter DO — window slides", () => {
  it("the rejected window opens up again after windowMs elapses", async () => {
    // Use a small window (60ms) so we can wait it out without a slow test.
    // We sleep ~3x the window to leave plenty of slack against jitter.
    const stub = freshStub();
    const SHORT_WINDOW = 60;

    await runInDurableObject(stub, async (instance: RateLimiter) => {
      // Fill the window.
      for (let i = 0; i < 3; i++) {
        const r = instance.check(3, SHORT_WINDOW);
        expect(r.ok).toBe(true);
      }
      const rejected = instance.check(3, SHORT_WINDOW);
      expect(rejected.ok).toBe(false);
    });

    // Wait past the window. Real wall-clock advance — Date.now() in the DO
    // will tick along with the host clock.
    await new Promise((resolve) => setTimeout(resolve, SHORT_WINDOW * 3));

    await runInDurableObject(stub, async (instance: RateLimiter) => {
      const r = instance.check(3, SHORT_WINDOW);
      // The window has slid past the original 3 hits; the limiter should
      // accept the new request.
      expect(r.ok).toBe(true);
    });
  });

  it("garbage-collects rows that fell out of the window (table stays bounded)", async () => {
    // Hit the limiter many times across multiple windows; assert the DB
    // size stays near `limit` rows after GC. This is the cleanup defence
    // from the algorithm: stale rows shouldn't linger.
    const stub = freshStub();
    const SHORT_WINDOW = 50;
    const LIMIT = 5;

    await runInDurableObject(stub, async (instance: RateLimiter, state) => {
      // Round 1: fill the window
      for (let i = 0; i < LIMIT; i++) {
        instance.check(LIMIT, SHORT_WINDOW);
      }
      const countRow1 = state.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM hits")
        .one();
      expect(countRow1.n).toBe(LIMIT);

      // Wait past window
      await new Promise((resolve) => setTimeout(resolve, SHORT_WINDOW * 3));

      // Trigger GC by issuing a fresh check — the DELETE in check() will
      // remove old rows before the count/insert.
      instance.check(LIMIT, SHORT_WINDOW);

      const countRow2 = state.storage.sql
        .exec<{ n: number }>("SELECT COUNT(*) AS n FROM hits")
        .one();
      // After GC we should be left with only the single new hit (the LIMIT
      // older ones were deleted).
      expect(countRow2.n).toBe(1);
    });
  });
});
