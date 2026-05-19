---
sidebar_position: 1
title: Missions
description: Goals users complete by accumulating qualifying events.
---

# Missions

A **Mission** is a goal a user can complete. Every mission has:

- A `MissionCriteria` — which event counts, how many, and (optionally) a time window or payload filter.
- A `Reward` — currency, badge, or item granted on claim.
- An optional `campaignId` and `expiresAt` so missions can be grouped into time-bounded promotions.

The QuestKit rule engine listens to incoming events, evaluates each criterion against the user's history, and writes a `MissionProgress` row. When `progress.status` transitions to `completed`, the user can call `POST /v1/missions/:id/claim` to mint the reward.

```text
   event ─┐                                 ┌─ locked    (not unlocked yet)
          │                                 │
          ▼                                 ▼
   ┌──────────────┐    matches    ┌──────────────┐    threshold
   │ rule engine  │──────────────►│  active      │──reached────► completed ──claim──► claimed
   └──────────────┘   criteria    └──────────────┘                  │
                                                                    │
                                                              reward minted
```

## Statuses

| Status      | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `locked`    | Prerequisites not met (e.g. mission belongs to a future campaign window) |
| `active`    | Counting toward the threshold                                            |
| `completed` | Threshold reached, reward not yet claimed                                |
| `claimed`   | Reward minted, balance updated                                           |

## Windows

Criteria can specify a `window`:

- `daily` — resets every UTC midnight
- `weekly` — resets every Monday UTC
- `lifetime` — never resets

## Filters

`criteria.filter` accepts a map of payload-path → `FilterClause` (`eq`, `gte`, `lte`, `gt`, `lt`, `in`). Events that don't match every clause are ignored.

See [the `Mission` and `MissionCriteria` types](https://github.com/ilGentEAcutoO/QuestKit/blob/main/packages/types/src/mission.ts) for the authoritative TypeScript surface.
