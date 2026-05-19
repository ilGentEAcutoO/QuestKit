/**
 * questkit-worker-webhook-consumer — drains `questkit-queue-webhooks`.
 *
 * Pipeline:
 *   1. Queue delivers a batch (up to `max_batch_size: 10`) of normalized
 *      QuestKit `Event` messages. The producer (questkit-worker-webhook-relay,
 *      TASK-021) sets `Event.idempotencyKey = "evt_${rawPayload.id}"` so the
 *      api worker's KV + partial-unique-index defence collapses duplicate
 *      deliveries (CF Queues is at-least-once).
 *   2. For each message, call `env.API.ingestEvent(event)` via the typed
 *      `WorkerEntrypoint` RPC into questkit-worker-api. The api's
 *      `ingestEventCore` runs the same idempotency → insert → rule engine →
 *      AE → cache pipeline as `POST /v1/events`.
 *   3. On success, `msg.ack()` so the queue forgets the message.
 *   4. On failure, `msg.retry({ delaySeconds })` with exponential backoff
 *      (30s, 60s, 120s, 240s, 480s). The queue config caps retries at 5;
 *      after the 5th, the message lands in `questkit-queue-webhooks-dlq`.
 *
 * Why exponential backoff?
 *   - Transient failures (api worker cold start, D1 contention) usually
 *     resolve in seconds; the first retry at 30s is enough.
 *   - Cascading failures (api worker down, D1 region outage) want longer
 *     gaps so we don't burn the retry budget in the first minute.
 *   - The doubling curve is the standard internet-distributed-systems
 *     default; it caps at 480s on attempt 5 (well under the 12h queue
 *     message age limit) and naturally exhausts the retry budget if the
 *     underlying problem persists, sending the message to DLQ for human
 *     review.
 *
 * Not done here:
 *   - HMAC verification — that's the relay's job. By the time a message
 *     reaches this worker, it's already passed signature checks.
 *   - Rate limiting — the queue itself provides backpressure; the RPC
 *     callee (api worker) trusts internal callers.
 *   - DLQ-side processing — the DLQ is owned by the queue config
 *     (`dead_letter_queue: "questkit-queue-webhooks-dlq"`); v0.1 leaves the
 *     DLQ inert (alarms / dashboards in v0.2 per ROADMAP).
 */
import type { Event } from "@questkit/types";

/**
 * Exponential backoff for queue retries.
 *
 * Curve (1-indexed attempts):
 *   1 → 30s, 2 → 60s, 3 → 120s, 4 → 240s, 5 → 480s
 *
 * Per CF Queues semantics, `attempts` is incremented before redelivery, so
 * the first failure arrives with `attempts === 1`. We subtract 1 before
 * shifting so the first retry waits the base 30s, not 60s.
 *
 * Capped to 480s on the 5th attempt — the queue config retries up to 5
 * times, so attempts 6+ never occur (the message is in DLQ by then).
 *
 * Exported for unit testing (queue.test.ts asserts the curve directly).
 */
export function backoffDelaySeconds(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  return 30 * 2 ** (safeAttempts - 1);
}

export default {
  async queue(
    batch: MessageBatch<Event>,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await env.API.ingestEvent(msg.body);
        msg.ack();
      } catch (err) {
        // Log at warn, not error, because retries are expected behaviour and
        // we don't want to wake oncall for every transient miss. The DLQ is
        // the real alert surface — anything that survives 5 retries deserves
        // attention; the message metadata + headers there will preserve the
        // failure context.
        const attempts = msg.attempts ?? 1;
        console.warn("[consumer] ingest failed", {
          id: msg.id,
          attempts,
          err: err instanceof Error ? err.message : String(err),
        });
        msg.retry({ delaySeconds: backoffDelaySeconds(attempts) });
      }
    }
  },
};
