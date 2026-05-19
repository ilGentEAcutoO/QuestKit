import type { Event } from "@questkit/types";
import {
  EventQueue,
  type QueuedEvent,
  type SendFn,
  type SendResult,
} from "../src/event-queue";
import { MemoryStorage } from "../src/storage";

function evt(overrides: Partial<Event> = {}): Event {
  return {
    userId: "u1",
    name: "purchase.completed",
    payload: { amount: 100 },
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

describe("eventQueue.enqueue", () => {
  it("enqueues a single event with an auto-generated idempotency key", () => {
    const storage = new MemoryStorage();
    const q = new EventQueue({ storage });
    const queued = q.enqueue(evt());
    expect(q.size()).toBe(1);
    expect(queued.idempotencyKey.length).toBeGreaterThan(0);
    expect(queued.attempts).toBe(0);
    expect(queued.nextRetryAt).toBe(0);
  });

  it("preserves a caller-supplied idempotency key", () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    const queued = q.enqueue(evt({ idempotencyKey: "custom-key" }));
    expect(queued.idempotencyKey).toBe("custom-key");
  });

  it("dedups by idempotencyKey (replace existing)", () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    q.enqueue(evt({ idempotencyKey: "same", payload: { x: 1 } }));
    q.enqueue(evt({ idempotencyKey: "same", payload: { x: 2 } }));
    expect(q.size()).toBe(1);
    expect(q.snapshot()[0]?.payload).toEqual({ x: 2 });
  });

  it("drops oldest when at maxQueueSize", () => {
    const q = new EventQueue({ storage: new MemoryStorage(), maxQueueSize: 2 });
    q.enqueue(evt({ idempotencyKey: "a" }));
    q.enqueue(evt({ idempotencyKey: "b" }));
    q.enqueue(evt({ idempotencyKey: "c" }));
    expect(q.size()).toBe(2);
    const keys = q.snapshot().map((s) => s.idempotencyKey);
    expect(keys).toEqual(["b", "c"]);
  });

  it("notifies listeners on enqueue", () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    const calls: number[] = [];
    q.onChange((depth) => calls.push(depth));
    q.enqueue(evt({ idempotencyKey: "a" }));
    q.enqueue(evt({ idempotencyKey: "b" }));
    expect(calls).toEqual([1, 2]);
  });

  it("unsubscribe removes the listener", () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    const calls: number[] = [];
    const off = q.onChange((d) => calls.push(d));
    q.enqueue(evt({ idempotencyKey: "a" }));
    off();
    q.enqueue(evt({ idempotencyKey: "b" }));
    expect(calls).toEqual([1]);
  });
});

describe("eventQueue.flush", () => {
  it("sends each event once on the happy path and clears the queue", async () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    q.enqueue(evt({ idempotencyKey: "a" }));
    q.enqueue(evt({ idempotencyKey: "b" }));
    const sent: string[] = [];
    const send: SendFn = jest.fn().mockImplementation(async (e: Event) => {
      sent.push(e.idempotencyKey ?? "");
      return {
        ok: true,
        eventId: `eid_${e.idempotencyKey ?? ""}`,
        missionsUpdated: [],
      } satisfies SendResult;
    });
    const result = await q.flush(send);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.dropped).toBe(0);
    expect(sent).toEqual(["a", "b"]);
    expect(q.size()).toBe(0);
  });

  it("schedules exp backoff on retryable failure (5xx)", async () => {
    let nowMs = 1000;
    const q = new EventQueue({
      storage: new MemoryStorage(),
      baseBackoffMs: 100,
      now: () => nowMs,
    });
    q.enqueue(evt({ idempotencyKey: "a" }));
    const send: SendFn = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503, retryable: true });
    await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    const item = q.snapshot()[0];
    expect(item).toBeDefined();
    expect(item?.attempts).toBe(1);
    // baseBackoffMs * 2^1 = 200
    expect(item?.nextRetryAt).toBe(nowMs + 200);
    // Next flush at the same now-tick is a no-op — not eligible yet.
    await q.flush(send);
    expect(send).toHaveBeenCalledTimes(1);
    // Advance past the retry window
    nowMs += 300;
    const send2: SendFn = jest.fn().mockResolvedValue({
      ok: true,
      eventId: "ok",
      missionsUpdated: [],
    });
    await q.flush(send2);
    expect(send2).toHaveBeenCalledTimes(1);
    expect(q.size()).toBe(0);
  });

  it("gives up after maxAttempts and drops the event", async () => {
    let nowMs = 0;
    const q = new EventQueue({
      storage: new MemoryStorage(),
      baseBackoffMs: 1,
      maxAttempts: 3,
      now: () => nowMs,
    });
    q.enqueue(evt({ idempotencyKey: "a" }));
    const send: SendFn = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, retryable: true });
    for (let i = 0; i < 5; i++) {
      await q.flush(send);
      nowMs += 1_000_000; // advance past any backoff window
    }
    expect(q.size()).toBe(0);
    // Sent attempts == maxAttempts (3)
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("drops on non-retryable (4xx) without retry", async () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    q.enqueue(evt({ idempotencyKey: "bad" }));
    const send: SendFn = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 400, retryable: false });
    const result = await q.flush(send);
    expect(result.failed).toBe(1);
    expect(result.sent).toBe(0);
    expect(q.size()).toBe(0);
  });

  it("treats sendFn throw as retryable", async () => {
    const q = new EventQueue({
      storage: new MemoryStorage(),
      baseBackoffMs: 50,
      now: () => 0,
    });
    q.enqueue(evt({ idempotencyKey: "boom" }));
    const send: SendFn = jest.fn().mockRejectedValue(new Error("offline"));
    await q.flush(send);
    expect(q.size()).toBe(1);
    expect(q.snapshot()[0]?.attempts).toBe(1);
  });

  it("re-entrant flush calls return immediately", async () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    q.enqueue(evt({ idempotencyKey: "a" }));
    let resolveSend!: (v: SendResult) => void;
    const send: SendFn = jest
      .fn()
      .mockImplementation(
        () => new Promise<SendResult>((res) => (resolveSend = res)),
      );
    const p1 = q.flush(send);
    const p2 = q.flush(send);
    resolveSend({ ok: true, eventId: "x", missionsUpdated: [] });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.sent + r2.sent).toBe(1);
    // The re-entrant flush returns all zeros
    expect(r2.sent + r2.failed + r2.dropped).toBe(0);
  });
});

describe("eventQueue.persist", () => {
  it("persists the queue and reloads it on a fresh instance", () => {
    const storage = new MemoryStorage();
    const q1 = new EventQueue({ storage });
    q1.enqueue(evt({ idempotencyKey: "a", payload: { x: 1 } }));
    q1.enqueue(evt({ idempotencyKey: "b", payload: { x: 2 } }));
    const q2 = new EventQueue({ storage });
    expect(q2.size()).toBe(2);
    const keys = q2.snapshot().map((s: QueuedEvent) => s.idempotencyKey);
    expect(keys).toEqual(["a", "b"]);
  });

  it("rejects malformed persisted entries", () => {
    const storage = new MemoryStorage();
    storage.set(
      "qk:event-queue",
      JSON.stringify([
        { not_an_event: true },
        {
          userId: "u",
          name: "n",
          payload: {},
          timestamp: 1,
          idempotencyKey: "ok",
          attempts: 0,
          nextRetryAt: 0,
        },
      ]),
    );
    const q = new EventQueue({ storage });
    expect(q.size()).toBe(1);
  });

  it("recovers from a malformed JSON blob", () => {
    const storage = new MemoryStorage();
    storage.set("qk:event-queue", "{not json");
    const q = new EventQueue({ storage });
    expect(q.size()).toBe(0);
  });
});

describe("eventQueue.clear", () => {
  it("empties the queue and persists the change", () => {
    const storage = new MemoryStorage();
    const q = new EventQueue({ storage });
    q.enqueue(evt({ idempotencyKey: "a" }));
    q.clear();
    expect(q.size()).toBe(0);
    const q2 = new EventQueue({ storage });
    expect(q2.size()).toBe(0);
  });
});

describe("eventQueue listener errors", () => {
  it("a throwing listener doesn't break enqueue", () => {
    const q = new EventQueue({ storage: new MemoryStorage() });
    q.onChange(() => {
      throw new Error("nope");
    });
    expect(() => q.enqueue(evt({ idempotencyKey: "a" }))).not.toThrow();
    expect(q.size()).toBe(1);
  });
});
