---
sidebar_position: 5
title: Balance
description: Currency balances for the authenticated user.
---

# Balance

Two endpoints. Both require `Authorization: Bearer <JWT>`.

## GET `/v1/balance`

Return every balance row the user has.

```bash
curl https://api.questkit.jairukchan.com/v1/balance \
  -H "Authorization: Bearer <JWT>"
```

### Response — 200 OK

```json
{
  "balances": [
    {
      "userId": "usr_demo_123",
      "currency": "gold",
      "amount": 1100,
      "updatedAt": 1716100100000
    },
    {
      "userId": "usr_demo_123",
      "currency": "point",
      "amount": 250,
      "updatedAt": 1716090000000
    }
  ]
}
```

An empty array (not 404) means the user is legitimately "0 of everything" — render that without a special case.

---

## GET `/v1/balance/:currency`

Return the balance row for one currency.

```bash
curl https://api.questkit.jairukchan.com/v1/balance/gold \
  -H "Authorization: Bearer <JWT>"
```

### Response — 200 OK

```json
{
  "balance": {
    "userId": "usr_demo_123",
    "currency": "gold",
    "amount": 1100,
    "updatedAt": 1716100100000
  }
}
```

### Errors

| HTTP | `error` code        | Meaning                                                                                    |
| ---- | ------------------- | ------------------------------------------------------------------------------------------ |
| 404  | `balance_not_found` | No row exists for `(userId, currency)`. Treat as 0 for display, or surface "never minted". |

The 404 response is informative: it lets clients distinguish "never minted" from "minted-then-decremented-to-zero" if that matters. If it doesn't matter, treat 404 and `amount: 0` the same way.
