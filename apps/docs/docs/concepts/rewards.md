---
sidebar_position: 3
title: Rewards
description: What a user receives when they claim a completed mission.
---

# Rewards

A **Reward** is what a user receives when they claim a completed mission. Rewards are a discriminated union over three kinds:

```ts
type Reward =
  | { kind: "currency"; currency: CurrencyCode; amount: number }
  | { kind: "badge"; badgeId: string }
  | { kind: "item"; itemId: string; quantity: number };
```

## Reward kinds

| Kind       | Stored in                                           | Visible via                              |
| ---------- | --------------------------------------------------- | ---------------------------------------- |
| `currency` | `balances` table                                    | `GET /v1/balance`, `<CoinBalance />`     |
| `badge`    | _(not minted in v0.1; passed through to client UI)_ | `RewardClaimToast`, mission card payload |
| `item`     | _(not minted in v0.1; passed through to client UI)_ | `RewardClaimToast`, mission card payload |

For v0.1 only `currency` rewards mutate server-side state — the balance row for `(userId, currency)` is incremented atomically alongside the `mission_progress.status = 'claimed'` write. `badge` and `item` rewards are returned to the client so your UI can render them; persisting them is your host application's responsibility (or a v0.2 roadmap item).

## Claim flow

```text
   client ──POST /v1/missions/:id/claim──► api worker
                                              │
                                              ▼
                              SELECT-then-CAS-batch in D1
                              (atomic completed → claimed
                               + balance += amount)
                                              │
                                              ▼
                                  SDKUpdate broadcasts
                                  ├─ reward.granted
                                  └─ balance.changed   (currency only)
```

Claims are **idempotent** on the `Idempotency-Key` header. Replays return the original `{ progress, balance, reward }` payload with `X-Idempotent-Replay: hit`.

## Currency codes

`CurrencyCode` is a `string` alias with three suggested values: `coin`, `point`, `gem`. Use whatever names suit your product — QuestKit doesn't enforce a registry.
