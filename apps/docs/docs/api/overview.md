---
sidebar_position: 1
title: Overview
description: Authentication, base URL, rate limits, and error model.
---

# API Overview

The QuestKit API is a JSON-over-HTTPS service hosted on Cloudflare Workers. One Worker (`questkit-worker-api`) owns every public endpoint listed in this section.

## Base URL

```
https://api.questkit.jairukchan.com
```

All endpoints are versioned under `/v1`.

## Authentication

Every endpoint except `POST /v1/auth/token` requires:

```
Authorization: Bearer <JWT>
```

The JWT is issued by `POST /v1/auth/token` from `(appId, appSecret, userId)`. It's signed HS256 with the Worker's `JWT_SECRET`, carries a 1-hour expiry, and includes a unique `jti` claim. JWTs can be revoked instantly via a KV denylist keyed by `jti`.

Mint tokens on **your backend**. Never ship `APP_SECRET` to the browser.

## Content type

Requests and responses are `application/json` unless noted otherwise. The SSE endpoint (`GET /v1/sse/updates`) returns `text/event-stream`.

## Rate limits

A Durable Object enforces per-JWT sliding-window limits on ingestion-style endpoints:

| Endpoint          | Limit         | Window |
| ----------------- | ------------- | ------ |
| `POST /v1/events` | 100 requests  | 60 s   |
| _other reads_     | _no DO limit_ | —      |

When you cross the threshold, you get:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
Content-Type: application/json

{ "error": "rate_limited", "retryAfterMs": 12000 }
```

## Idempotency

For mutating endpoints (`/v1/events`, `/v1/missions/:id/claim`), pass an `Idempotency-Key` header. The server caches the response for 24 hours per `(userId, key)` tuple and returns the cached body on replay:

```http
HTTP/1.1 200 OK
X-Idempotent-Replay: hit
```

A `db-hit` value means the partial-unique index caught a replay the KV layer missed (rare race window). Both are safe.

## Error model

Errors come back as `{ "error": "<code>", "message"?: "..." }` with a meaningful HTTP status.

| HTTP | `error` code          | Meaning                                              |
| ---- | --------------------- | ---------------------------------------------------- |
| 400  | `validation_error`    | Body shape failed validation.                        |
| 400  | `invalid_event`       | `POST /v1/events` body failed validation.            |
| 401  | `invalid_credentials` | `POST /v1/auth/token` rejected the secret.           |
| 401  | `unauthorized`        | Missing or invalid JWT.                              |
| 403  | `user_mismatch`       | Event body's `userId` doesn't match the JWT's `sub`. |
| 404  | `mission_not_found`   | The mission doesn't exist.                           |
| 404  | `balance_not_found`   | No balance row for `(userId, currency)`.             |
| 404  | `campaign_not_found`  | The campaign doesn't exist.                          |
| 409  | `claim_not_ready`     | Mission isn't `completed` yet (or no progress row).  |
| 429  | `rate_limited`        | Sliding-window cap hit. See `Retry-After`.           |

> Note: AI-recommendation failures used to surface as `502 ai_response_malformed` / `503 ai_unavailable`. Since v0.1.4 those failure modes are absorbed by the route: `GET /v1/recommendations` returns `200 { fallback: true, ... }` instead. See [`/v1/recommendations`](./recommendations.md#graceful-fallback--200-ok-fallback-true).

## CORS

The API accepts cross-origin requests with `Authorization` in the preflight. There's no Origin allowlist — the SDK is designed to run on any host. Tokens are scoped per-app + per-user, which is the boundary that matters.

## Where to next

- [`POST /v1/auth/token`](./auth.md) — mint a JWT
- [`POST /v1/events`](./events.md) — send an event
- [`GET /v1/missions`](./missions.md) — list missions and progress
- [`GET /v1/sse/updates`](./sse.md) — real-time updates
- [`POST /v1/webhook/incoming`](./webhooks.md) — inbound webhooks (HMAC-signed)
- [`GET /v1/recommendations`](./recommendations.md) — AI-curated suggestions
