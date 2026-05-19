---
sidebar_position: 6
title: Campaigns
description: List and fetch time-bounded campaigns.
---

# Campaigns

Two endpoints. Both require `Authorization: Bearer <JWT>`.

## GET `/v1/campaigns`

List campaigns active or upcoming. Pass `?include=expired` to retrieve historical rows.

```bash
curl https://api.questkit.jairukchan.com/v1/campaigns \
  -H "Authorization: Bearer <JWT>"
```

| Query param | Type     | Description                                           |
| ----------- | -------- | ----------------------------------------------------- |
| `include`   | `string` | Set to `expired` to bypass the `endAt >= now` filter. |

### Response — 200 OK

```json
{
  "campaigns": [
    {
      "id": "spring-2026",
      "title": "Spring Sale",
      "description": "Earn double rewards through April.",
      "startAt": 1714521600000,
      "endAt": 1717113600000,
      "missionIds": ["spring-buyer", "spring-explorer", "spring-streak"],
      "theme": { "primaryColor": "oklch(0.72 0.18 30)" },
      "bannerUrl": "https://assets.questkit.jairukchan.com/banners/spring-2026.jpg"
    }
  ]
}
```

By default, campaigns whose `endAt < now` are filtered out. Upcoming campaigns (`startAt > now`) **are** included so a client can pre-fetch tomorrow's banner.

---

## GET `/v1/campaigns/:id`

Fetch a single campaign. Pass `?include=missions` to hydrate the mission rows in the same response.

```bash
curl https://api.questkit.jairukchan.com/v1/campaigns/spring-2026?include=missions \
  -H "Authorization: Bearer <JWT>"
```

### Response — 200 OK (without `include`)

```json
{
  "campaign": {
    "id": "spring-2026",
    "title": "Spring Sale",
    "description": "Earn double rewards through April.",
    "startAt": 1714521600000,
    "endAt": 1717113600000,
    "missionIds": ["spring-buyer", "spring-explorer", "spring-streak"],
    "theme": { "primaryColor": "oklch(0.72 0.18 30)" }
  }
}
```

### Response — 200 OK (with `include=missions`)

```json
{
  "campaign": {
    "id": "spring-2026",
    "title": "Spring Sale",
    "startAt": 1714521600000,
    "endAt": 1717113600000,
    "missionIds": ["spring-buyer", "spring-explorer", "spring-streak"]
  },
  "missions": [
    {
      "id": "spring-buyer",
      "title": "Spring Buyer",
      "description": "Make 3 purchases this month.",
      "criteria": {
        "eventName": "purchase.completed",
        "count": 3,
        "window": "lifetime"
      },
      "reward": { "kind": "currency", "currency": "gold", "amount": 200 },
      "campaignId": "spring-2026"
    }
  ]
}
```

### Errors

| HTTP | `error` code         | Meaning                   |
| ---- | -------------------- | ------------------------- |
| 404  | `campaign_not_found` | No campaign with this id. |
