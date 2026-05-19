---
sidebar_position: 3
title: POST /v1/events
description: Ingest a single event. Idempotent. Rate-limited.
---

# POST `/v1/events`

Ingest one event. Runs the rule engine against the user's open missions and broadcasts any progress changes via SSE.

## Request

```bash
curl -X POST https://api.questkit.jairukchan.com/v1/events \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: abc123-uuid" \
  -d '{
    "userId": "usr_demo_123",
    "name": "purchase.completed",
    "payload": { "product": "boots", "amount": 49.99 },
    "timestamp": 1716100000000
  }'
```

| Field            | Type     | Required | Description                                                                   |
| ---------------- | -------- | -------- | ----------------------------------------------------------------------------- |
| `userId`         | `string` | yes      | Must equal the JWT's `sub` claim, or you'll get a 403.                        |
| `name`           | `string` | yes      | Event name. Stable values recommended (e.g. `purchase.completed`).            |
| `payload`        | `object` | yes      | Arbitrary key/value data. Used by `MissionCriteria.filter`.                   |
| `timestamp`      | `number` | yes      | Unix milliseconds. Trusted as-is.                                             |
| `idempotencyKey` | `string` | no       | Optional body-level key. Header `Idempotency-Key` wins when both are present. |

`Idempotency-Key` is the recommended location (RFC 9530 / SDK-friendly).

## Response — 200 OK

```json
{
  "accepted": true,
  "eventId": "evt_01HQK7N5...",
  "missionsUpdated": ["daily-streak", "spring-buyer"]
}
```

| Field             | Type       | Description                                                   |
| ----------------- | ---------- | ------------------------------------------------------------- |
| `accepted`        | `true`     | Always `true` on a 200.                                       |
| `eventId`         | `string`   | Server-generated event identifier.                            |
| `missionsUpdated` | `string[]` | Mission IDs whose progress changed as a result of this event. |

### Idempotent replay headers

| Header                | Value    | Meaning                                                       |
| --------------------- | -------- | ------------------------------------------------------------- |
| `X-Idempotent-Replay` | `hit`    | Served from KV cache (key matched within 24h).                |
| `X-Idempotent-Replay` | `db-hit` | KV missed; the partial-unique index caught a duplicate write. |

## Errors

| HTTP | `error` code    | Meaning                                        |
| ---- | --------------- | ---------------------------------------------- |
| 400  | `invalid_event` | Body shape failed validation.                  |
| 401  | `unauthorized`  | Missing or invalid JWT.                        |
| 403  | `user_mismatch` | `body.userId` doesn't match the JWT's `sub`.   |
| 429  | `rate_limited`  | Hit the 100/min cap. See `Retry-After` header. |

## Side effects

- Inserts a row into `events`.
- Evaluates every open mission criterion that names this event; upserts `mission_progress`.
- Broadcasts `mission.progress` / `mission.completed` SDKUpdates via the SSE Hub for this user.
- Writes a data point to Analytics Engine.
- Caches the response under `(userId, idempotencyKey)` for 24 hours.
