---
sidebar_position: 2
title: POST /v1/auth/token
description: Exchange an app secret + userId for a short-lived JWT.
---

# POST `/v1/auth/token`

Mint a JWT for a user. Call this from your backend — never from the browser, since the request carries `appSecret`.

## Request

```bash
curl -X POST https://api.questkit.jairukchan.com/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "appId": "your-app-id",
    "appSecret": "<your APP_SECRET>",
    "userId": "usr_demo_123"
  }'
```

| Field       | Type     | Required | Description                                   |
| ----------- | -------- | -------- | --------------------------------------------- |
| `appId`     | `string` | yes      | Your application identifier.                  |
| `appSecret` | `string` | yes      | The shared secret. Treat like a password.     |
| `userId`    | `string` | yes      | Opaque user identifier from your host system. |

## Response — 200 OK

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfZGVtb18xMjMiLCJpYXQiOjE3MTYxMDAwMDAsImV4cCI6MTcxNjEwMzYwMCwianRpIjoiYWJjMTIzLXV1aWQifQ.signature",
  "expiresAt": 1716103600000
}
```

| Field       | Type     | Description                                                           |
| ----------- | -------- | --------------------------------------------------------------------- |
| `token`     | `string` | HS256-signed JWT. Send as `Authorization: Bearer <token>`.            |
| `expiresAt` | `number` | Token expiry in **unix milliseconds**. The token is valid for 1 hour. |

The JWT carries:

- `sub` — the userId you passed
- `iat` — issued-at, unix seconds
- `exp` — expiry, unix seconds (1 hour after iat)
- `jti` — random 16-byte hex string (used for revocation via KV denylist)

## Errors

| HTTP | `error` code          | Meaning                                                                                                                                                            |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400  | `validation_error`    | Missing/empty `appId`, `appSecret`, or `userId`.                                                                                                                   |
| 401  | `invalid_credentials` | `appSecret` didn't match. **Note**: we intentionally do not distinguish "wrong app id" from "wrong secret" — both return this error to prevent app-id enumeration. |

## Side effects

- A `users` row is upserted for `userId` via `INSERT OR IGNORE` (idempotent).
- The `appSecret` comparison is timing-safe (Web Crypto HMAC verify with a fresh random key, not `===`).

## Server-rendered token pattern

For the vanilla embed, your page server should inject the freshly-minted token into a meta tag:

```html
<meta name="questkit-token" content="<JWT>" />
```

The embed reads it once at boot. Refresh logic (re-fetching the token before the 1-hour expiry) is your application's responsibility — the embed does not re-mint.
