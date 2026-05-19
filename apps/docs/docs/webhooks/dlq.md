---
sidebar_position: 4
title: Dead Letter Queue
description: What lands in the DLQ after 5 failed retries.
---

# Dead Letter Queue

After 5 failed retries, the consumer's `msg.retry(...)` calls exhaust the queue's `max_retries` budget. The message lands in `questkit-queue-webhooks-dlq` and is no longer processed automatically.

```text
   attempt 1  fail ─► retry +30s
   attempt 2  fail ─► retry +60s
   attempt 3  fail ─► retry +120s
   attempt 4  fail ─► retry +240s
   attempt 5  fail ─► retry +480s
   attempt 6  …never happens. Message goes to DLQ.
```

Total time spent retrying before DLQ: roughly 15 minutes 30 seconds (30+60+120+240+480 = 930 s).

## Why backoff?

- **Transient failures** (API cold start, D1 contention) usually resolve in seconds. The 30 s first retry catches the bulk.
- **Cascading failures** (API outage, D1 region issue) want longer gaps. Doubling spreads the retry storm over ~15 minutes.
- **Bug-shaped failures** (validation error in the relay's `normalize`, broken schema migration) won't fix themselves on retry. Five attempts are enough to confirm the problem; the DLQ is the alert surface.

The doubling curve caps at 480 s on attempt 5, well under the 12-hour Cloudflare Queues message age limit.

## What's in a DLQ message

The same `Event` payload that was originally produced, plus message metadata:

- `id` — queue message id
- `timestamp` — original produce time
- `attempts` — how many delivery attempts were made (5)
- `body` — the QuestKit `Event` shape

## What to do with DLQ messages

QuestKit v0.1 leaves the DLQ **inert** — it's a parking lot for messages that need human review. No automatic alarms, no automatic reprocessing. The DLQ messages stay in the queue (up to the 14-day max retention) until you either:

- Add a DLQ consumer worker (v0.2 roadmap).
- Manually drain via `wrangler queues consumer <name>` for triage.
- Fix the underlying bug and replay via a script that reproduces the original webhook.

## Monitoring (suggested)

- Watch the **DLQ depth** in the Cloudflare dashboard.
- Set a Cloudflare alert on `dlq.message_count > 0`.
- Log the failure reason on the consumer side at WARN. The default behaviour already does this:
  ```
  [consumer] ingest failed { id, attempts, err }
  ```

## Why no auto-replay?

A misbehaving sender that floods the relay with malformed payloads could trigger millions of DLQ messages if auto-replay were on. Manual triage is the safer default for v0.1.
