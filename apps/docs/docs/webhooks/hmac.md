---
sidebar_position: 2
title: HMAC Signing
description: Stripe-style HMAC signature format and verification.
---

# HMAC Signing

The relay verifies webhook signatures using the **Stripe-style scheme**: an HMAC-SHA256 of `${unix_timestamp}.${raw_body}` keyed by `WEBHOOK_HMAC_SECRET`. The header format and payload composition are intentionally compatible with Stripe so providers (or self-hosted webhook senders) that already speak Stripe can integrate without a custom signing path.

## Header format

```
Stripe-Signature: t=1716100000,v1=5257a869e7ec...hex...
```

| Part  | Meaning                                    |
| ----- | ------------------------------------------ |
| `t=`  | Unix **seconds** at the moment of signing. |
| `v1=` | Lowercase hex-encoded HMAC-SHA256 digest.  |

Multiple `v0=`, `v1=` pairs are tolerated (Stripe's forward-compat policy — unknown schemes are ignored). Only `v1=` is currently verified.

## Signed payload

```
${t}.${rawBody}
```

Where `rawBody` is the **raw bytes** of the HTTP request body — not the JSON-reparsed object. Any whitespace change, key reorder, or unicode normalisation will shift the digest. The relay reads `await c.req.text()` (not `.json()`) before verification.

## Replay window

Signatures are valid for ±300 seconds around the local Worker clock. Beyond that → 401 `signature_expired`. Within the window but with a bad digest → 401 `invalid_signature`.

The order of checks is fixed: parse → window → HMAC. Window-before-HMAC avoids leaking whether a stale signature was otherwise valid through timing.

## Signing code (sender side)

This is the recipe a webhook sender uses to produce the header. The relay verifies exactly this output.

```ts
// sender-side — Node 20+ / any environment with Web Crypto
async function signWebhook(rawBody: string, secret: string): Promise<string> {
  const t = Math.floor(Date.now() / 1000);
  const data = new TextEncoder().encode(`${t}.${rawBody}`);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign("HMAC", key, data);
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `t=${t},v1=${hex}`;
}

// usage
const body = JSON.stringify({
  id: "evt_abc123",
  type: "...",
  created: 1716100000,
  data: { object: {} },
});
const headerValue = await signWebhook(body, process.env.WEBHOOK_HMAC_SECRET);

await fetch("https://webhook.questkit.jairukchan.com/v1/webhook/incoming", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Stripe-Signature": headerValue,
  },
  body, // send the EXACT bytes that were signed
});
```

## Verification code (reference)

This is the verification path the relay runs (simplified). `crypto.subtle.verify` is timing-safe by spec.

```ts
async function verify(
  rawBody: string,
  header: string,
  secret: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((pair) => pair.split("=").map((s) => s.trim())),
  );
  const t = Number.parseInt(parts.t!, 10);
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > 300) return false;

  const sigBytes = Uint8Array.from(
    parts.v1!.match(/.{1,2}/g)!.map((h) => parseInt(h, 16)),
  );

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  return crypto.subtle.verify(
    "HMAC",
    key,
    sigBytes,
    new TextEncoder().encode(`${t}.${rawBody}`),
  );
}
```

The real relay implementation lives in [`workers/webhook-relay/src/hmac.ts`](https://github.com/ilGentEAcutoO/QuestKit/blob/main/workers/webhook-relay/src/hmac.ts).
