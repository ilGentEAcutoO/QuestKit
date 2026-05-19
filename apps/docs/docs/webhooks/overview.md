---
sidebar_position: 1
title: Overview
description: The two-worker inbound webhook pipeline.
---

# Webhooks Overview

QuestKit ingests inbound webhooks through a two-worker pipeline. The split keeps the public-facing endpoint minimal (fast cold start, no DB or AI bindings) while async retry happens behind a Cloudflare Queue.

```text
                          ╔══════════════════════════════╗
                          ║  third-party (Stripe etc.)   ║
                          ╚═════════════╤════════════════╝
                                        │ POST
                                        ▼
   ┌────────────────────────────────────────────────────────────┐
   │  questkit-worker-webhook-relay                             │
   │  • verify HMAC-SHA256 (Stripe-Signature header)            │
   │  • normalize → QuestKit Event                              │
   │  • produce to queue                                        │
   │  • return 202 immediately                                  │
   └─────────────────────────────┬──────────────────────────────┘
                                 │
                                 ▼
                  ┌──────────────────────────────┐
                  │  questkit-queue-webhooks     │  at-least-once
                  │  (Cloudflare Queues)         │  max_batch_size: 10
                  └──────────────┬───────────────┘
                                 │
                                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  questkit-worker-webhook-consumer                          │
   │  • for each msg in batch:                                  │
   │      env.API.ingestEvent(msg.body)  ←─── WorkerEntrypoint  │
   │      msg.ack()                            RPC into the API │
   │  • on failure: msg.retry({ delaySeconds })                 │
   │      exponential backoff 30/60/120/240/480s                │
   │  • after 5 attempts → DLQ                                  │
   └─────────────────────────────┬──────────────────────────────┘
                                 │ RPC (typed)
                                 ▼
   ┌────────────────────────────────────────────────────────────┐
   │  questkit-worker-api ::ingestEvent()                       │
   │  Same pipeline as POST /v1/events:                         │
   │    KV idempotency → D1 insert → rule engine → AE → cache   │
   └────────────────────────────────────────────────────────────┘
```

## Why two workers?

- **Cold-start budget.** The public endpoint takes traffic from the open internet. Keeping it minimal (no D1 / KV / AI bindings) means the cold start is measured in single-digit milliseconds.
- **Async retry.** Cloudflare Queues handles backoff, batching, and DLQ semantics natively. The consumer is just a queue handler.
- **Backpressure.** If the API has a bad minute, the queue absorbs the load and the consumer drains at the API's pace.
- **Failure isolation.** A bug in the consumer can't take down the public endpoint, and vice versa.

## Failure modes & where they surface

| Failure                                  | Surfaced as                                                   | Where            |
| ---------------------------------------- | ------------------------------------------------------------- | ---------------- |
| Bad HMAC signature                       | 401 `invalid_signature`                                       | relay → caller   |
| Timestamp outside ±300 s window          | 401 `signature_expired`                                       | relay → caller   |
| Malformed JSON or payload shape          | 400 `invalid_*`                                               | relay → caller   |
| API transient error (cold start, D1 lag) | retry with exponential backoff                                | consumer → queue |
| API persistent error                     | DLQ after 5 attempts                                          | consumer → DLQ   |
| Workers AI unavailable                   | logged, ingest still succeeds (AI is optional in ingest path) | consumer → API   |

## Reading next

- [HMAC](./hmac.md) — header format and a verification code sample
- [Queue Semantics](./queue-semantics.md) — at-least-once, idempotency, batching
- [DLQ](./dlq.md) — what lands in the dead-letter queue and what to do about it
