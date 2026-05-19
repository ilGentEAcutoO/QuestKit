/**
 * Durable Object unit tests for `SSEHub` (TASK-011).
 *
 * Strategy:
 *
 *   The DO is exercised over HTTP via `stub.fetch(...)` because subscribe()
 *   returns a streamed Response - we want to read the SSE body chunks from
 *   outside the DO. Going through `runInDurableObject` would force us to
 *   reach into private fields; HTTP keeps the test honest.
 *
 *   For each test we create a fresh DO id so writer state never leaks.
 *
 * SSE framing under test:
 *
 *   - Initial sentinel: `: connected\n\n` (SSE comment line).
 *   - Broadcast: `event: update\ndata: <body>\n\n`.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

function freshStub() {
  const id = env.SSE_HUB.newUniqueId();
  return env.SSE_HUB.get(id);
}

/**
 * Read one SSE message (delimited by `\n\n`) from a stream reader. Returns
 * the concatenated chunks up to and including the first `\n\n`.
 *
 * Why this exists: a single SSE message can be split across multiple
 * `reader.read()` chunks. We accumulate until the delimiter shows up so the
 * test reads "one logical SSE frame" regardless of chunk boundaries.
 */
async function readOneSseFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = "";
  while (!buf.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value !== undefined) buf += decoder.decode(value, { stream: true });
  }
  return buf;
}

describe("sse-hub DO — broadcast with no subscribers", () => {
  it("returns 200 {delivered:0} when no one is listening", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "balance.changed", data: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { delivered: number };
    expect(body.delivered).toBe(0);
  });
});

describe("sse-hub DO — subscribe", () => {
  it("opens a text/event-stream response with the connected sentinel", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/subscribe");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    // First chunk should contain the `: connected` sentinel.
    const reader = res.body!.getReader();
    const frame = await readOneSseFrame(reader);
    expect(frame).toContain(": connected");
    // Note: we deliberately do NOT cancel the reader here; the DO writer is
    // still attached. The DO's writer.closed cleanup happens when the
    // request goes out of scope at the end of the test isolate.
    void reader.cancel();
  });
});

describe("sse-hub DO — broadcast reaches subscribers", () => {
  it("delivers the message to a single subscriber with the right framing", async () => {
    const stub = freshStub();

    // 1. Open a subscriber and read the sentinel out so we know the writer
    //    is registered before we broadcast.
    const sub = await stub.fetch("https://_/subscribe");
    expect(sub.status).toBe(200);
    const reader = sub.body!.getReader();
    const connected = await readOneSseFrame(reader);
    expect(connected).toContain(": connected");

    // 2. Broadcast.
    const payload = JSON.stringify({
      type: "balance.changed",
      data: { userId: "u_test", currency: "coin", amount: 100, updatedAt: 0 },
    });
    const bcast = await stub.fetch("https://_/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
    });
    expect(bcast.status).toBe(200);
    const bcastBody = (await bcast.json()) as { delivered: number };
    expect(bcastBody.delivered).toBe(1);

    // 3. Read the next SSE frame; it should be the broadcast message.
    const frame = await readOneSseFrame(reader);
    expect(frame).toContain("event: update");
    expect(frame).toContain(`data: ${payload}`);

    void reader.cancel();
  });

  it("delivers a broadcast to MULTIPLE subscribers (fanout count = N)", async () => {
    const stub = freshStub();

    // Open three concurrent subscriptions.
    const subs = await Promise.all([
      stub.fetch("https://_/subscribe"),
      stub.fetch("https://_/subscribe"),
      stub.fetch("https://_/subscribe"),
    ]);
    const readers = subs.map((s) => s.body!.getReader());

    // Drain the initial connected sentinel on each so the writers are
    // registered before we broadcast.
    for (const r of readers) {
      const connected = await readOneSseFrame(r);
      expect(connected).toContain(": connected");
    }

    const payload = JSON.stringify({
      type: "reward.granted",
      data: {
        userId: "u_test",
        reward: { kind: "currency", currency: "coin", amount: 10 },
        missionId: "mis_test",
      },
    });
    const bcast = await stub.fetch("https://_/broadcast", {
      method: "POST",
      body: payload,
    });
    const bcastBody = (await bcast.json()) as { delivered: number };
    expect(bcastBody.delivered).toBe(3);

    // Each reader should receive the message.
    for (const r of readers) {
      const frame = await readOneSseFrame(r);
      expect(frame).toContain("event: update");
      expect(frame).toContain(`data: ${payload}`);
    }

    // Clean up readers (these resolve once the response stream is cancelled).
    for (const r of readers) void r.cancel();
  });
});

describe("sse-hub DO — unknown paths", () => {
  it("returns 404 for an unknown path", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/wat", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("returns 404 for /broadcast called with GET", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/broadcast");
    expect(res.status).toBe(404);
  });

  it("returns 404 for /subscribe called with POST", async () => {
    const stub = freshStub();
    const res = await stub.fetch("https://_/subscribe", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
