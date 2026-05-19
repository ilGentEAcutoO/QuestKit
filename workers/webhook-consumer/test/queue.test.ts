/**
 * Queue handler tests for `questkit-worker-webhook-consumer` — TDD-first.
 *
 * Per plan §10.2 L1: `vi.mock` cannot reach into the workerd isolate. We use
 * the official `createMessageBatch` + `getQueueResult` + `createExecutionContext`
 * trio from `cloudflare:test` instead. This invokes the handler directly with
 * a synthesised `MessageBatch` and a plain JS `env` object — no workerd
 * boundary crossed, so a hand-rolled `env.API` stub works as expected.
 *
 * One observed limitation of `getQueueResult` in the installed pool-workers
 * (0.16.6): `result.retryMessages` records `{ msgId }` only — the
 * `delaySeconds` we pass to `msg.retry()` is consumed by the queue layer but
 * not echoed back in the test result. To assert the backoff curve we spy on
 * each `Message.retry` directly via `vi.spyOn` before invoking the handler;
 * the spy captures the QueueRetryOptions argument verbatim.
 *
 * Scenarios covered:
 *   - Successful ingest → `msg.ack()` (single + batch)
 *   - Transient failure → `msg.retry()` with exponential backoff (curves: 1, 2, 3, 5)
 *   - Mixed batch (some ack, some retry) routes per message correctly
 *   - DLQ-after-N-retries is a queue-level setting (declared in
 *     wrangler.jsonc); the handler test verifies retry is requested for
 *     every failure, and trusts the queue to route to DLQ after
 *     `max_retries: 5` per CF docs.
 */
import type { Event } from "@questkit/types";
import {
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
} from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker, { backoffDelaySeconds } from "../src/index";

const QUEUE_NAME = "questkit-queue-webhooks";

/**
 * Build a canonical Event mirroring what the relay produces in normalize.ts
 * (`Event.idempotencyKey = "evt_${rawPayload.id}"`).
 */
function sampleEvent(overrides: Partial<Event> = {}): Event {
  return {
    userId: "cus_xxx",
    name: "payment_intent.succeeded",
    payload: { id: "pi_xxx", amount: 2000, currency: "usd" },
    timestamp: Date.now(),
    idempotencyKey: "evt_abc123",
    ...overrides,
  };
}

/**
 * Build a minimal `env` shape that satisfies the handler's needs. We cast to
 * the runtime `Env` type because the handler only ever reads `env.API`.
 */
function buildEnv(
  ingestEvent: (
    event: Event,
  ) => Promise<{ accepted: boolean; missionsUpdated: string[] }>,
): Env {
  return {
    API: { ingestEvent },
  } as unknown as Env;
}

/**
 * Install spies on `retry` and `ack` for every message in the batch and run
 * the handler. Returns the spies indexed by msgId so each test can assert the
 * exact arguments. Mirrors the pattern relay tests use against
 * `WEBHOOK_QUEUE.send`.
 */
async function runHandler(
  batch: MessageBatch<Event>,
  env: Env,
): Promise<{
  retrySpies: Map<string, ReturnType<typeof vi.spyOn>>;
  ackSpies: Map<string, ReturnType<typeof vi.spyOn>>;
  result: Awaited<ReturnType<typeof getQueueResult>>;
}> {
  const retrySpies = new Map<string, ReturnType<typeof vi.spyOn>>();
  const ackSpies = new Map<string, ReturnType<typeof vi.spyOn>>();
  for (const msg of batch.messages) {
    retrySpies.set(msg.id, vi.spyOn(msg, "retry"));
    ackSpies.set(msg.id, vi.spyOn(msg, "ack"));
  }
  const ctx = createExecutionContext();
  await worker.queue(batch, env, ctx);
  const result = await getQueueResult(batch, ctx);
  return { retrySpies, ackSpies, result };
}

describe("backoff curve", () => {
  it("doubles from 30s per attempt", () => {
    expect(backoffDelaySeconds(1)).toBe(30);
    expect(backoffDelaySeconds(2)).toBe(60);
    expect(backoffDelaySeconds(3)).toBe(120);
    expect(backoffDelaySeconds(4)).toBe(240);
    expect(backoffDelaySeconds(5)).toBe(480);
  });

  it("treats undefined-coerced attempts as the first try", () => {
    // `msg.attempts ?? 1` in the handler — if a fake batch omits attempts,
    // the handler defaults to 1, which yields 30s. Direct call here mirrors
    // the same invariant.
    expect(backoffDelaySeconds(0)).toBe(30);
    expect(backoffDelaySeconds(-5)).toBe(30);
  });
});

describe("queue handler — successful ingest", () => {
  it("acks a single message when API.ingestEvent resolves", async () => {
    const ingestEvent = vi
      .fn()
      .mockResolvedValue({ accepted: true, missionsUpdated: [] });
    const env = buildEnv(ingestEvent);
    const event = sampleEvent();

    const batch = createMessageBatch<Event>(QUEUE_NAME, [
      { id: "msg-1", body: event, timestamp: new Date(), attempts: 1 },
    ]);
    const { ackSpies, retrySpies, result } = await runHandler(batch, env);

    expect(ingestEvent).toHaveBeenCalledTimes(1);
    expect(ingestEvent).toHaveBeenCalledWith(event);
    expect(result.outcome).toBe("ok");
    expect(ackSpies.get("msg-1")).toHaveBeenCalledTimes(1);
    expect(retrySpies.get("msg-1")).not.toHaveBeenCalled();
    expect(result.explicitAcks).toEqual(["msg-1"]);
    expect(result.retryMessages).toEqual([]);
  });

  it("acks every message in a multi-message batch on individual success", async () => {
    const ingestEvent = vi
      .fn()
      .mockResolvedValue({ accepted: true, missionsUpdated: ["m1"] });
    const env = buildEnv(ingestEvent);

    const batch = createMessageBatch<Event>(QUEUE_NAME, [
      {
        id: "msg-a",
        body: sampleEvent({ idempotencyKey: "evt_a" }),
        timestamp: new Date(),
        attempts: 1,
      },
      {
        id: "msg-b",
        body: sampleEvent({ idempotencyKey: "evt_b" }),
        timestamp: new Date(),
        attempts: 1,
      },
      {
        id: "msg-c",
        body: sampleEvent({ idempotencyKey: "evt_c" }),
        timestamp: new Date(),
        attempts: 1,
      },
    ]);
    const { ackSpies, retrySpies, result } = await runHandler(batch, env);

    expect(ingestEvent).toHaveBeenCalledTimes(3);
    expect(result.outcome).toBe("ok");
    for (const id of ["msg-a", "msg-b", "msg-c"]) {
      expect(ackSpies.get(id)).toHaveBeenCalledTimes(1);
      expect(retrySpies.get(id)).not.toHaveBeenCalled();
    }
    expect(new Set(result.explicitAcks)).toEqual(
      new Set(["msg-a", "msg-b", "msg-c"]),
    );
  });
});

describe("queue handler — transient failures retry with exponential backoff", () => {
  it("retries with delaySeconds=30 on attempts=1 (first failure)", async () => {
    const ingestEvent = vi.fn().mockRejectedValue(new Error("transient"));
    const env = buildEnv(ingestEvent);

    const batch = createMessageBatch<Event>(QUEUE_NAME, [
      { id: "msg-1", body: sampleEvent(), timestamp: new Date(), attempts: 1 },
    ]);
    const { ackSpies, retrySpies, result } = await runHandler(batch, env);

    expect(ingestEvent).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe("ok"); // handler returned normally; retry recorded
    expect(ackSpies.get("msg-1")).not.toHaveBeenCalled();
    expect(retrySpies.get("msg-1")).toHaveBeenCalledTimes(1);
    expect(retrySpies.get("msg-1")).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(result.retryMessages.map((r: { msgId: string }) => r.msgId)).toEqual(
      ["msg-1"],
    );
  });

  it("retries with delaySeconds=60 on attempts=2", async () => {
    const ingestEvent = vi.fn().mockRejectedValue(new Error("transient"));
    const env = buildEnv(ingestEvent);

    const batch = createMessageBatch<Event>(QUEUE_NAME, [
      { id: "msg-1", body: sampleEvent(), timestamp: new Date(), attempts: 2 },
    ]);
    const { retrySpies } = await runHandler(batch, env);

    expect(retrySpies.get("msg-1")).toHaveBeenCalledWith({ delaySeconds: 60 });
  });

  it("retries with delaySeconds=480 on attempts=5 (final retry before DLQ)", async () => {
    const ingestEvent = vi.fn().mockRejectedValue(new Error("permanent"));
    const env = buildEnv(ingestEvent);

    const batch = createMessageBatch<Event>(QUEUE_NAME, [
      { id: "msg-1", body: sampleEvent(), timestamp: new Date(), attempts: 5 },
    ]);
    const { retrySpies } = await runHandler(batch, env);

    // Note: the queue config caps at max_retries=5. After this retry, the
    // queue itself routes the message to questkit-queue-webhooks-dlq — that
    // routing is verified at runtime (wrangler dashboard / dead-letter
    // inspection), not at the handler unit level. See plan §10.2.
    expect(retrySpies.get("msg-1")).toHaveBeenCalledWith({ delaySeconds: 480 });
  });

  it("retries only the failing messages in a mixed-result batch", async () => {
    const ingestEvent = vi
      .fn()
      .mockResolvedValueOnce({ accepted: true, missionsUpdated: [] })
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ accepted: true, missionsUpdated: [] });
    const env = buildEnv(ingestEvent);

    const batch = createMessageBatch<Event>(QUEUE_NAME, [
      {
        id: "msg-ok-1",
        body: sampleEvent({ idempotencyKey: "evt_1" }),
        timestamp: new Date(),
        attempts: 1,
      },
      {
        id: "msg-fail",
        body: sampleEvent({ idempotencyKey: "evt_2" }),
        timestamp: new Date(),
        attempts: 3,
      },
      {
        id: "msg-ok-2",
        body: sampleEvent({ idempotencyKey: "evt_3" }),
        timestamp: new Date(),
        attempts: 1,
      },
    ]);
    const { ackSpies, retrySpies, result } = await runHandler(batch, env);

    expect(ingestEvent).toHaveBeenCalledTimes(3);
    expect(ackSpies.get("msg-ok-1")).toHaveBeenCalledTimes(1);
    expect(ackSpies.get("msg-ok-2")).toHaveBeenCalledTimes(1);
    expect(ackSpies.get("msg-fail")).not.toHaveBeenCalled();
    expect(retrySpies.get("msg-fail")).toHaveBeenCalledWith({
      delaySeconds: 120, // attempts=3 → 30 * 2^(3-1) = 120s
    });
    expect(retrySpies.get("msg-ok-1")).not.toHaveBeenCalled();
    expect(retrySpies.get("msg-ok-2")).not.toHaveBeenCalled();
    expect(new Set(result.explicitAcks)).toEqual(
      new Set(["msg-ok-1", "msg-ok-2"]),
    );
    expect(result.retryMessages.map((r: { msgId: string }) => r.msgId)).toEqual(
      ["msg-fail"],
    );
  });
});

describe("queue handler — DLQ trust boundary", () => {
  it("documents that DLQ routing is queue-level, not handler-level", () => {
    // The handler always calls msg.retry() on failure. After
    // max_retries (configured to 5 in wrangler.jsonc) the queue routes
    // the message to dead_letter_queue: questkit-queue-webhooks-dlq.
    //
    // This is verified by:
    //   1. wrangler.jsonc declares max_retries=5 + dead_letter_queue
    //   2. Cloudflare's queue infrastructure honours those settings
    //   3. Manual smoke test post-deploy: send a deliberately-failing event
    //      (e.g. point env.API at a 500-returning stub) and observe the
    //      message land in the DLQ via `wrangler queues consumer get`.
    //
    // Unit-asserting DLQ routing here would require simulating the queue
    // itself — out of scope for a handler test.
    expect(true).toBe(true);
  });
});
