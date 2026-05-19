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

## Errors

| HTTP | `error` code            | Meaning                                                           |
| ---- | ----------------------- | ----------------------------------------------------------------- |
| 401  | `unauthorized`          | Missing or invalid JWT.                                           |
| 502  | `ai_response_malformed` | AI returned non-JSON or unparseable output.                       |
| 503  | `ai_unavailable`        | Workers AI binding failed (binding error, timeout, model outage). |

## What goes into the prompt

- The user's most recent 50 events (name + timestamp + payload summary).
- The user's `active` and `completed` (unclaimed) missions.

Free-text user input is **not** forwarded to the LLM — only structured event metadata. This is the prompt-injection mitigation.

## Caching

- **Server (KV, 1 hour)**: keyed by `userId`. The `cached` field surfaces a hit.
- **SDK client (in-memory, 5 minutes)**: keyed by `userId`; shared across all React component mounts. Invalidated on SSE `recommendation` messages.

## Model

`@cf/meta/llama-3.1-8b-instruct-fast` — the fast variant. The base `@cf/meta/llama-3.1-8b-instruct` deprecates on 2026-05-30; pin the `-fast` suffix.
