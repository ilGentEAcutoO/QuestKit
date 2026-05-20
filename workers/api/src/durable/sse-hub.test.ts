/**
 * SSEHub deadlock regression tests (Phase 8 / v0.1.4 TASK-001).
 *
 * The user-visible bug: claim hangs forever, counters freeze. The root cause
 * was that `SSEHub.broadcast()` iterated writers sequentially with `await`, so
 * a SINGLE stalled subscriber would block every other writer indefinitely.
 *
 * These tests pin the new behaviour:
 *   - broadcast must NOT serialise on a stalled writer
 *   - a single stalled writer is bounded by a 1s per-writer cap
 *   - healthy writers in the same fanout still receive the message
 *
 * Strategy: use the DO's real `/subscribe` HTTP surface to register writers,
 * then create a stalled writer by leaving its readable side undrained (HWM=1
 * backpressure — the ": connected" sentinel fills the buffer; the next write
 * pends forever). Healthy writers actively drain in a detached read loop so
 * the DO's writes against them resolve immediately. We assert:
 *
 *   (1) healthy writers receive the broadcast message PROMPTLY (within
 *       ~100ms), proving the stalled writer no longer gates them;
 *   (2) the broadcast Response returns within the per-writer 1s cap +
 *       jitter, proving stalls don't hang the call forever.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

/** Fresh DO stub with a random id. Each test gets its own clean writer set. */
function freshStub() {
  const id = env.SSE_HUB.newUniqueId();
  return env.SSE_HUB.get(id);
}

/**
 * Subscribe but do NOT drain — the readable's HWM=1 buffer fills with the
 * ": connected" sentinel emitted on subscribe, so the next write (the
 * broadcast) pends forever waiting for the reader to consume that chunk.
 * Returns the response so the test can hold a reference (keeping the stream
 * alive — the DO sees a live but stuck writer).
 */
async function createStalledSubscriber(
  stub: DurableObjectStub,
): Promise<Response> {
  const res = await stub.fetch("https://_/subscribe");
  if (res.status !== 200) {
    throw new Error(`stalled subscriber: unexpected status ${res.status}`);
  }
  // Crucially: we do NOT call res.body!.getReader() here. The TransformStream
  // backing this response has its HWM=1 buffer full of the sentinel chunk,
  // so the DO's next write against this writer will pend on backpressure.
  return res;
}

/**
 * Subscribe AND actively drain in a detached reader loop. Returns a
 * `framesNow()` snapshot accessor so tests can assert on what reached the
 * subscriber without having to wait for the stream to close.
 */
async function createHealthySubscriber(stub: DurableObjectStub): Promise<{
  cancel: () => Promise<void>;
  framesNow: () => string[];
}> {
  const res = await stub.fetch("https://_/subscribe");
  if (res.status !== 200) {
    throw new Error(`healthy subscriber: unexpected status ${res.status}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const frames: string[] = [];
  // Detached drain loop — keeps draining until the reader is cancelled.
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined) frames.push(decoder.decode(value));
      }
    } catch {
      // Cancellation is expected at teardown.
    }
  })();
  return {
    cancel: async () => {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
    },
    framesNow: () => frames.slice(),
  };
}

describe("sse-hub DO — broadcast parallelism (deadlock regression)", () => {
  it("healthy writers are NOT blocked by a stalled writer (parallel fanout)", async () => {
    // The bug under test: with serial `await w.write(message)` in a loop,
    // a single backpressured writer would gate every subsequent writer
    // forever. The fix runs writes in parallel via Promise.allSettled,
    // capped at WRITER_TIMEOUT_MS per writer (1s).
    //
    // We assert:
    //   (1) the healthy writers receive the message PROMPTLY (within the
    //       first 100ms), proving the parallel fanout works regardless of
    //       what the stalled writer does;
    //   (2) the broadcast call itself eventually returns within the
    //       per-writer cap + workerd jitter (well under the unbounded
    //       "forever" of the regressed code).
    const stub = freshStub();

    // Register subscribers in the DO. createStalledSubscriber returns
    // without draining, so the writer's HWM=1 buffer stays full.
    const stalled = await createStalledSubscriber(stub);
    const healthy1 = await createHealthySubscriber(stub);
    const healthy2 = await createHealthySubscriber(stub);

    // Wait a tick to let each subscriber's initial sentinel be processed
    // by the DO (the healthy ones drain, the stalled one buffers).
    await new Promise((r) => setTimeout(r, 20));

    // 2. Kick off the broadcast.
    const t0 = Date.now();
    const broadcastPromise = stub.fetch("https://_/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "balance.changed", data: { amount: 1 } }),
    });

    // 3. Race a "healthy writers have received the message" sentinel
    //    against a 100ms budget. With the old serial implementation the
    //    healthy writers would never see the message (the stalled writer
    //    is iterated first or second and blocks the loop). With the
    //    parallel fix they see it immediately.
    const healthyDeliveredWithinBudget = await Promise.race([
      (async () => {
        while (true) {
          const seen1 = healthy1
            .framesNow()
            .some((f) => f.includes("event: update"));
          const seen2 = healthy2
            .framesNow()
            .some((f) => f.includes("event: update"));
          if (seen1 && seen2) return true;
          await new Promise((r) => setTimeout(r, 5));
        }
      })(),
      new Promise<false>((r) => setTimeout(() => r(false), 100)),
    ]);
    expect(healthyDeliveredWithinBudget).toBe(true);

    // 4. The broadcast call itself eventually returns (capped at the
    //    per-writer timeout + workerd jitter). 2s ceiling absorbs the 1s
    //    cap + setup overhead.
    const res = await broadcastPromise;
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(2000);

    // 5. Cleanup: cancel the healthy reader loops and the stalled body
    //    so streams settle.
    await healthy1.cancel();
    await healthy2.cancel();
    try {
      await stalled.body?.cancel();
    } catch {
      // ignore
    }
  });

  it("a SINGLE stalled writer alone caps the broadcast at the per-writer 1s timeout", async () => {
    // If every writer stalls, the broadcast must still return — capped at
    // the 1s per-writer ceiling, not blocked indefinitely.
    const stub = freshStub();
    const stalled = await createStalledSubscriber(stub);
    await new Promise((r) => setTimeout(r, 20));

    const t0 = Date.now();
    const res = await stub.fetch("https://_/broadcast", {
      method: "POST",
      body: JSON.stringify({ type: "balance.changed", data: { amount: 1 } }),
    });
    const elapsed = Date.now() - t0;

    expect(res.status).toBe(200);
    // Should be ~1000ms (the per-writer cap), well under 5s (the old
    // unbounded path) and not under 500ms (would mean the cap fired before
    // the timer expired). Allow a generous ceiling for workerd jitter.
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(2500);

    try {
      await stalled.body?.cancel();
    } catch {
      // ignore
    }
  });
});
