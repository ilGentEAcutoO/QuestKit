---
sidebar_position: 8
title: POST /v1/webhook/incoming
description: HMAC-verified inbound webhook ingestion.
---

# POST `/v1/webhook/incoming`

This endpoint is hosted on a separate Worker — `questkit-worker-webhook-relay` — at `https://webhook.questkit.jairukchan.com/v1/webhook/incoming`. It accepts inbound webhooks from third-party providers (Stripe in v0.1, more providers planned), verifies the HMAC signature, normalises the payload into a QuestKit `Event`, and produces to a Cloudflare Queue for async ingestion.

The relay returns **202 Accepted** as soon as the message is on the queue. The consumer drains the queue at its own pace and calls the API's ingest pipeline via typed `WorkerEntrypoint` RPC.

```text
   Stripe ──► /v1/webhook/incoming ──► queue ──► consumer ──RPC──► api ingest
              (HMAC verify)              (at-least-once)            (idempotent)
```

## Request

```bash
curl -X POST https://webhook.questkit.jairukchan.com/v1/webhook/incoming \
  -H "Content-Type: application/json" \
  -H "Stripe-Signature: t=1716100000,v1=5257a869e7ec...hex..." \
  -d '{
    "id": "evt_abc123",
    "type": "payment_intent.succeeded",
    "created": 1716100000,
    "data": {
      "object": {
        "customer": "usr_demo_123",
        "amount": 4999
      }
    }
  }'
```

| Header             | Required | Description                                                                        |
| ------------------ | -------- | ---------------------------------------------------------------------------------- |
| `Stripe-Signature` | yes      | Stripe-format `t=<unix-seconds>,v1=<hex-sha256>`. See [HMAC](../webhooks/hmac.md). |
| `Content-Type`     | yes      | Must be `application/json`.                                                        |

## Response — 202 Accepted

```json
{
  "accepted": true,
  "eventId": "evt_abc123"
}
```

`eventId` is `evt_<rawPayload.id>` — it doubles as the QuestKit `Event.idempotencyKey`, so duplicate deliveries from Stripe (or the queue's at-least-once semantics) collapse cleanly at the API layer.

## Errors

| HTTP | `error` code           | Meaning                                                  |
| ---- | ---------------------- | -------------------------------------------------------- |
| 400  | `malformed_signature`  | `Stripe-Signature` header missing pieces or wrong shape. |
| 400  | `invalid_json`         | Body wasn't parseable JSON.                              |
| 400  | `invalid_payload_root` | Body wasn't an object.                                   |
| 400  | `invalid_id`           | Missing or non-string `id`.                              |
| 400  | `invalid_type`         | Missing or non-string `type`.                            |
| 400  | `invalid_created`      | Missing or non-numeric `created`.                        |
| 400  | `invalid_data_object`  | Missing or non-object `data.object`.                     |
| 401  | `invalid_signature`    | HMAC didn't match.                                       |
| 401  | `signature_expired`    | Timestamp outside the ±300 s replay window.              |

## HMAC verification

The relay computes `HMAC-SHA256(WEBHOOK_HMAC_SECRET, "${t}.${rawBody}")` and verifies it against the `v1=` part of the header using `crypto.subtle.verify` (timing-safe by spec). Bytes-for-bytes — any whitespace change in the JSON body invalidates the signature.

See [Webhooks → HMAC](../webhooks/hmac.md) for the signing recipe and a code sample.

## Idempotency & queue semantics

- Each message carries `Event.idempotencyKey = "evt_${rawPayload.id}"`, which the API's ingest pipeline uses to deduplicate.
- The queue is at-least-once. Treat duplicates as expected; the idempotency layer handles them.
- After 5 failed retries on the consumer side, the message lands in `questkit-queue-webhooks-dlq`. See [Webhooks → DLQ](../webhooks/dlq.md).

## Note on the relay's responsibilities

The relay does **not** rate-limit, write to D1, or call Workers AI. Its job is to verify the signature, parse the JSON, normalise, and enqueue — minimal so the cold start stays fast under public-internet traffic.
