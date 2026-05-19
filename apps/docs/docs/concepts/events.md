---
sidebar_position: 2
title: Events
description: The atomic facts your app sends to QuestKit.
---

# Events

An **Event** is the atomic fact your application reports to QuestKit. Every gamification rule, balance change, and mission progression eventually traces back to an event. Events are intentionally narrow:

```ts
interface Event {
  userId: string;
  name: string; // e.g. "purchase.completed"
  payload: Record<string, unknown>; // arbitrary structured data
  timestamp: number; // unix ms
  idempotencyKey?: string;
}
```

## Lifecycle

```text
   client ──POST /v1/events──► api worker
                                  │
                                  ├─► KV idempotency (24h)
                                  │
                                  ├─► D1 insert (events table)
                                  │
                                  ├─► rule engine evaluates open missions
                                  │      │
                                  │      └─► mission_progress upsert + SSE broadcast
                                  │
                                  └─► Analytics Engine write
```

## Idempotency

Pass `Idempotency-Key` as a request header (preferred) or `idempotencyKey` in the body. QuestKit caches the result for 24 hours per `(userId, key)` tuple. Replays return the original response with `X-Idempotent-Replay: hit` so retry loops are safe.

## Where events come from

- Direct SDK calls (`useEvent().fireEvent(...)`, `window.QuestKit.fireEvent(...)`)
- Direct REST calls from your backend (`POST /v1/events`)
- Inbound webhooks (Stripe etc.) via the [webhook pipeline](../webhooks/overview.md), which normalises provider payloads into the `Event` shape and queues them for async ingestion

## Tips

- **Use stable `name` values** — e.g. `purchase.completed`, not `purchase_2024_q4`. Names are the join key for mission criteria.
- **Put filterable values in `payload`** — `payload.product` lets a mission filter to "buys of `product = "boots"`.
- **Send `timestamp` from the client** when it matters (offline-first apps); QuestKit trusts the timestamp it receives.
