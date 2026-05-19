---
sidebar_position: 4
title: Missions
description: List, fetch, and claim missions.
---

# Missions

Three endpoints. All require `Authorization: Bearer <JWT>`.

## GET `/v1/missions`

List missions with the caller's progress folded in.

```bash
curl https://api.questkit.jairukchan.com/v1/missions?status=active&limit=10 \
  -H "Authorization: Bearer <JWT>"
```

| Query param  | Type     | Description                                                      |
| ------------ | -------- | ---------------------------------------------------------------- |
| `campaignId` | `string` | Filter to a single campaign.                                     |
| `status`     | `string` | `active` / `completed` / `claimed` / `locked` / `all` (default). |
| `limit`      | `number` | Page size.                                                       |
| `cursor`     | `string` | Opaque cursor from a previous response's `nextCursor`.           |

### Response — 200 OK

```json
{
  "missions": [
    {
      "id": "daily-streak",
      "title": "Daily Streak",
      "description": "Log in 7 days in a row.",
      "criteria": {
        "eventName": "daily.login",
        "count": 7,
        "window": "lifetime"
      },
      "reward": { "kind": "currency", "currency": "gold", "amount": 100 },
      "campaignId": null,
      "expiresAt": null,
      "iconUrl": null
    }
  ],
  "progress": {
    "daily-streak": {
      "userId": "usr_demo_123",
      "missionId": "daily-streak",
      "status": "active",
      "progress": 0.42,
      "currentCount": 3,
      "targetCount": 7,
      "updatedAt": 1716100000000
    }
  },
  "nextCursor": "eyJpZCI6Im..."
}
```

`progress` is keyed by mission id; entries only exist for missions that have a server-side progress row for the caller.

---

## GET `/v1/missions/:id`

Fetch one mission and the caller's progress.

```bash
curl https://api.questkit.jairukchan.com/v1/missions/daily-streak \
  -H "Authorization: Bearer <JWT>"
```

### Response — 200 OK

```json
{
  "mission": {
    "id": "daily-streak",
    "title": "Daily Streak",
    "description": "Log in 7 days in a row.",
    "criteria": {
      "eventName": "daily.login",
      "count": 7,
      "window": "lifetime"
    },
    "reward": { "kind": "currency", "currency": "gold", "amount": 100 }
  },
  "progress": {
    "userId": "usr_demo_123",
    "missionId": "daily-streak",
    "status": "active",
    "progress": 0.42,
    "currentCount": 3,
    "targetCount": 7,
    "updatedAt": 1716100000000
  }
}
```

`progress` is `null` if the user has never fired a qualifying event for this mission.

### Errors

| HTTP | `error` code        | Meaning                  |
| ---- | ------------------- | ------------------------ |
| 404  | `mission_not_found` | No mission with this id. |

---

## POST `/v1/missions/:id/claim`

Atomic transition `completed` → `claimed`. Mints the reward, increments the balance (currency rewards only), broadcasts `reward.granted` + `balance.changed` SDKUpdates.

```bash
curl -X POST https://api.questkit.jairukchan.com/v1/missions/daily-streak/claim \
  -H "Authorization: Bearer <JWT>" \
  -H "Idempotency-Key: abc123-uuid"
```

### Response — 200 OK

```json
{
  "progress": {
    "userId": "usr_demo_123",
    "missionId": "daily-streak",
    "status": "claimed",
    "progress": 1,
    "currentCount": 7,
    "targetCount": 7,
    "updatedAt": 1716100100000
  },
  "balance": {
    "userId": "usr_demo_123",
    "currency": "gold",
    "amount": 1100,
    "updatedAt": 1716100100000
  },
  "reward": { "kind": "currency", "currency": "gold", "amount": 100 }
}
```

`balance` is `null` if the reward kind is not `currency`.

### Errors

| HTTP | `error` code        | Meaning                                                                         |
| ---- | ------------------- | ------------------------------------------------------------------------------- |
| 404  | `mission_not_found` | The mission doesn't exist at all.                                               |
| 409  | `claim_not_ready`   | Either no progress row, or the row's status isn't `completed`. Try again later. |

### Idempotency

Pass `Idempotency-Key`. The response is cached under `(userId, "claim:<key>")` for 24h; replays return the original payload with `X-Idempotent-Replay: hit`. SSE broadcasts only fire on the first (non-replayed) claim — replays do not re-broadcast.
