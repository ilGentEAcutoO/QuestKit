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
  "token": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3JfZGVtbyJ9.<signature>",
  "expiresAt": 1716103600000
}
```

> The `token` above is **truncated for docs**; a real JWT's three segments are longer. The structure stays the same: `base64url(header).base64url(payload).base64url(hmacSignature)`.

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

## Cookie-based auth (browser hosts)

For hosts that store the QuestKit JWT in an `HttpOnly` cookie, you can omit the `Authorization: Bearer` header and send the token via a `qk_token` cookie instead. The worker accepts either; **the header path takes precedence when both are present**, so the SDK, Newman, the demo, and the e2e suite are unaffected.

```http
GET /v1/missions HTTP/1.1
Host: api.questkit.jairukchan.com
Cookie: qk_token=<JWT>
Origin: https://app.example.com
```

### CSRF protection

When the token comes from a cookie, the worker enforces an additional same-origin guard because browsers auto-send cookies cross-origin. The request must include **either** of:

- An `Origin` header that exactly matches one of the entries in your worker's `ALLOWED_ORIGINS` env var (comma-separated full origins, e.g. `https://demo.questkit.jairukchan.com,https://app.example.com`), **or**
- A custom header `X-Requested-With: qk` (sufficient on its own — a cross-origin attacker cannot set this header without triggering a CORS preflight your worker hasn't authorised).

If neither signal is present the worker rejects with HTTP 401 and `csrf_guard` as the body. Header-Bearer callers do **not** need this guard — the `Authorization` header itself is CORS-safelisted-forbidden and so cannot be forged cross-origin.

| Auth method                     | CSRF guard | Rationale                                                                                |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| `Authorization: Bearer <token>` | _skipped_  | Header is browser-CORS-controlled; presence implies explicit JS from a trusted origin.   |
| `Cookie: qk_token=<token>`      | required   | Cookies are auto-sent cross-origin; attacker site could otherwise trigger state changes. |

### Setup

Declare `ALLOWED_ORIGINS` as a plain `vars` entry in `workers/api/wrangler.jsonc` (the allowlist is not a secret):

```jsonc
{
  "vars": {
    "ALLOWED_ORIGINS": "https://demo.questkit.jairukchan.com,https://app.example.com",
  },
}
```

Or per-environment via `wrangler.toml`'s `[env.<name>.vars]` block, or at deploy time:

```bash
wrangler deploy --var ALLOWED_ORIGINS:"https://app.example.com"
```

Leave the value empty if you only want the `X-Requested-With: qk` path enabled. The SDK already sets this header on every request, so the cookie path works out-of-the-box for SDK callers without operator setup — the `ALLOWED_ORIGINS` allowlist is purely for raw `fetch`/XHR callers that don't set the custom header.

### Errors

| HTTP | Body                                                            | Meaning                                                                                               |
| ---- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 401  | `missing_token`                                                 | Neither `Authorization: Bearer` header nor `qk_token` cookie was present.                             |
| 401  | `csrf_guard`                                                    | Cookie present, but neither `Origin` (matching `ALLOWED_ORIGINS`) nor `X-Requested-With: qk` was set. |
| 401  | `expired` / `invalid_signature` / `malformed` / `token_revoked` | Standard token-verification failures — same codes as the header path.                                 |
