---
sidebar_position: 9
title: GET /v1/recommendations
description: AI-curated mission recommendations.
---

# GET `/v1/recommendations`

AI-curated mission recommendations. Backed by `@cf/meta/llama-3.1-8b-instruct-fast` running on the same Worker. Cached in KV for 1 hour per user.

## Request

```bash
curl https://api.questkit.jairukchan.com/v1/recommendations \
  -H "Authorization: Bearer <JWT>"
```

## Response — 200 OK

```json
{
  "missionIds": ["spring-buyer", "daily-streak", "explorer"],
  "reason": "You've been on a checkout streak — try the Spring Buyer mission for double rewards.",
  "cached": false,
  "count": 3
}
```

| Field        | Type       | Description                                                                                        |
| ------------ | ---------- | -------------------------------------------------------------------------------------------------- |
| `missionIds` | `string[]` | Up to 3 recommended mission ids. Hallucinated ids (not in the user's active set) are filtered out. |
| `reason`     | `string`   | One-sentence "why" the AI surfaced these. Safe to render as italic caption copy.                   |
| `cached`     | `boolean`  | `true` when served from the 1-hour KV cache.                                                       |
| `count`      | `number`   | `= missionIds.length`. Lets the UI check `count === 0` without scanning the array.                 |
| `fallback`   | `boolean?` | Present and `true` only when the AI was unavailable / malformed — see "Graceful fallback" below.   |

## Empty cases

- **User has no `active` or `completed` missions** → the route short-circuits without calling the AI:
  ```json
  {
    "missionIds": [],
    "reason": "Start firing events to unlock personalised missions.",
    "cached": false,
    "count": 0
  }
  ```
- **AI returned nothing useful** → `missionIds: []`, with a reason explaining the empty result.

## Graceful fallback — 200 OK (`fallback: true`)

Since v0.1.4, when the Workers AI binding returns a malformed payload or fails outright (timeout, outage, deprecated model envelope mismatch), the route degrades gracefully instead of returning 502/503. The body is:

```json
{
  "missionIds": [],
  "reason": "AI picks unavailable right now.",
  "cached": false,
  "count": 0,
  "fallback": true
}
```

Clients should branch on `fallback === true` and render a tasteful empty-state (the bundled `<RecommendedMissions>` React component already does this). Fallback results are **not** cached — the next call retries the AI.

## Errors

| HTTP | `error` code   | Meaning                 |
| ---- | -------------- | ----------------------- |
| 401  | `unauthorized` | Missing or invalid JWT. |

AI failure modes no longer surface as HTTP errors — see "Graceful fallback" above.

## What goes into the prompt

- The user's most recent 50 events (name + timestamp + payload summary).
- The user's `active` and `completed` (unclaimed) missions.

Free-text user input is **not** forwarded to the LLM — only structured event metadata. This is the prompt-injection mitigation.

## Caching

- **Server (KV, 1 hour)**: keyed by `userId`. The `cached` field surfaces a hit.
- **SDK client (in-memory, 5 minutes)**: keyed by `userId`; shared across all React component mounts. Invalidated on SSE `recommendation` messages.

## Model

`@cf/meta/llama-3.1-8b-instruct-fast` — the fast variant. The base `@cf/meta/llama-3.1-8b-instruct` deprecates on 2026-05-30; pin the `-fast` suffix.
