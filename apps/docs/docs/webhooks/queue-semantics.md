---
sidebar_position: 3
title: Queue Semantics
description: At-least-once delivery, idempotency, and batching.
---

# Queue Semantics

`questkit-queue-webhooks` is a Cloudflare Queue with these settings:

- `max_batch_size: 10` — the consumer receives up to 10 messages per invocation.
- `max_retries: 5` — after the 5th failed attempt, the message goes to `questkit-queue-webhooks-dlq`.
- Producer: `questkit-worker-webhook-relay` (`env.WEBHOOK_QUEUE.send(event)`).
- Consumer: `questkit-worker-webhook-consumer`.

## At-least-once delivery

CF Queues guarantees at-least-once delivery. Treat duplicates as expected.

QuestKit deduplicates at the API layer, not the queue layer. Every message carries `Event.idempotencyKey = "evt_${rawPayload.id}"`. The API's ingest pipeline has two defences:

1. **KV idempotency cache** — keyed by `(userId, idempotencyKey)`, 24-hour TTL. KV hit returns the cached `eventId` + `missionsUpdated` without re-running the rule engine. Replay header: `X-Idempotent-Replay: hit`.
2. **D1 partial-unique index** on `(userId, idempotencyKey) WHERE idempotencyKey IS NOT NULL`. Catches duplicates the KV layer missed (rare race). Replay header: `X-Idempotent-Replay: db-hit`.

```text
   queue ──► consumer ──RPC──► api.ingestEvent
                                    │
                                    ▼
                              KV cache lookup
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                       hit│                   │miss
                          │                   ▼
                          │            D1 INSERT
                          │           ┌───────┴───────┐
                          │           │ success       │ unique-violation
                          │           ▼               ▼
                          │     rule engine        return cached row
                          │      AE write           (db-hit)
                          │      KV cache write
                          │           │
                          └───────────┴───────► return to consumer
                                                        │
                                                        ▼
                                                  msg.ack()
```

## Batching

The consumer iterates each message in a batch independently. A failure on one message doesn't block the others — that message gets a `msg.retry(...)` with backoff while the rest can `msg.ack()`.

## Failure → retry

On a thrown error from `env.API.ingestEvent(...)`, the consumer calls:

```ts
msg.retry({ delaySeconds: backoffDelaySeconds(msg.attempts) });
```

Where `backoffDelaySeconds(attempts) = 30 * 2 ** (attempts - 1)`. The full curve:

| Attempt | Delay before next try       |
| ------- | --------------------------- |
| 1       | 30 s                        |
| 2       | 60 s                        |
| 3       | 120 s                       |
| 4       | 240 s                       |
| 5       | 480 s                       |
| 6+      | never reached — goes to DLQ |

After 5 retries, the message lands in `questkit-queue-webhooks-dlq`. See [DLQ](./dlq.md).

## Service-binding RPC

The consumer calls the API via `WorkerEntrypoint` RPC (typed, zero serialization overhead). The `services` binding in `workers/webhook-consumer/wrangler.jsonc` looks like:

```jsonc
"services": [
  { "binding": "API", "service": "questkit-worker-api", "entrypoint": "QuestKitAPI" }
]
```

The API exposes a `QuestKitAPI` `WorkerEntrypoint` whose `ingestEvent(event)` method runs the same `ingestEventCore` pipeline as `POST /v1/events`. The HTTP-only concerns (auth, rate-limit, body validation, userId-match) live in the route — the trusted RPC path skips them.

## Why not just rely on the HTTP API?

- One less serialisation hop (RPC passes the JS object directly).
- One less hop subject to public-internet timeouts.
- No need to mint a JWT for the consumer — the service binding is the trust boundary.
