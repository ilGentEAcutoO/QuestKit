---
title: ADR-004 — Durable Objects for per-JWT rate limiting
status: Accepted
date: 2026-05-19
deciders: Bosso (@ilGentEAcutoO)
---

# ADR-004: Durable Objects for per-JWT rate limiting

## Context

QuestKit ingests events from arbitrary host applications through a JWT-scoped
API. Without back-pressure, a single misbehaving host could saturate the
`/v1/events` endpoint and degrade service for every other tenant. The plan
(§2.5) sets a default ingest cap of 100 requests per minute and a read cap
of 1,000 requests per minute, both per-JWT and both as sliding windows. Both
limits return HTTP 429 with an RFC-7231 `Retry-After` header on rejection.

A sliding-window limiter has tighter accuracy than a fixed-window or
token-bucket variant: the window slides continuously, so a burst at second
59 plus another burst at second 61 cannot bypass the cap. The cost is that
the limiter needs to remember individual hit timestamps, not just a single
counter.

Cloudflare's edge places requests from one user against the nearest
data-center. Two requests from the same JWT may land on two different
Workers in two different regions within seconds. The rate-limiter state
must therefore converge on **one location per JWT** regardless of which
edge the requests came through.

## Decision

The `RateLimiter` Durable Object class
([workers/api/src/durable/rate-limiter.ts](../../workers/api/src/durable/rate-limiter.ts))
maintains per-JWT sliding-window state in SQLite-backed DO storage. Each JWT
routes to one DO instance via `idFromName(jti)` where `jti` is the token's
unique identifier from the JWT payload. The DO exposes a single HTTP method
`GET /check?limit=<n>&window=<ms>`; the caller passes the limit and window
size, and the DO returns `200 {ok:true, remaining:N}` (allowed) or
`429 {ok:false, retryAfterMs:N}` with the `Retry-After` header set
(rejected).

The on-disk schema is one table:

```sql
CREATE TABLE hits (ts INTEGER NOT NULL);
CREATE INDEX idx_hits_ts ON hits(ts);
```

The check algorithm is: (1) GC rows where `ts < now - window`, (2) `COUNT(*)`
the survivors, (3) if count ≥ limit return 429 with `retryAfterMs` computed
from the oldest surviving hit's age, otherwise (4) INSERT the new hit and
return 200. The single-writer guarantee of a DO ensures the
read-then-count-then-write sequence is atomic for one JWT; cross-JWT
contention is non-existent because the DOs are partitioned by `jti`.

The DO class name is referenced verbatim in
[`workers/api/wrangler.jsonc`](../../workers/api/wrangler.jsonc) under both
`migrations[].new_sqlite_classes` and `durable_objects.bindings` (plan
amendment A5).

## Consequences

### Positive

- **Per-user precision.** No cross-user contention. One user's burst cannot
  push another user closer to their limit.
- **Sliding window, not fixed.** A user firing 99 events at second 59 of
  one minute and 99 events at second 1 of the next cannot bypass the cap —
  the second burst evaluates against a window that still contains the first.
- **Edge-local execution.** The DO lives in the region of first contact for
  a `jti`. Subsequent checks are co-located unless the user moves region.
- **Persistent state.** SQLite-backed DO storage survives DO eviction. A
  user who keeps requesting at the cap line cannot reset their window by
  forcing the DO to sleep.
- **Bounded table size.** The check path begins with a GC of expired rows,
  so the `hits` table stays at roughly `limit` rows in the steady state.
  Memory and storage are constant per JWT.
- **Cost.** At Cloudflare's current DO pricing the limiter runs around $1
  per million ingest checks — acceptable for portfolio-stage volume and
  predictable beyond it.

### Negative

- **Region-jump edge case.** If a user's traffic suddenly moves to a new
  region (mobile network handover, traveling user), the new region may
  briefly route to a different DO instance before convergence. The current
  implementation does not pass a `locationHint` on `idFromName`; this is a
  known v0.2 hardening item.
- **Cold-DO latency.** First request to a sleeping DO incurs an extra ~30 ms
  to wake it. After warm-up the check is sub-millisecond.
- **JTI churn.** The DO is keyed by `jti`, so a token rotation creates a new
  DO with no history. This is intentional for security (revoked tokens
  cannot replay), but if an attacker mints many tokens, they create many
  DOs. Mitigation: the `/v1/auth/token` endpoint is gated by `appSecret`
  and the JWT denylist (plan §5).

### Neutral

- **DO storage migration tag.** The class is declared inside
  `migrations[].new_sqlite_classes` (plan amendment A5). Renaming the class
  in future requires a new migration tag — a one-line config change, but
  documented here so a future contributor doesn't try to rename without a
  migration step.

## Alternatives considered

### 1. KV TTL counter

**Pros**: Trivial — `kv.put(jti, count+1, { expirationTtl: 60 })`.
**Cons**: KV's eventual consistency makes the read-modify-write race-prone
across regions. Two near-simultaneous requests in two regions can both read
`count=99` and both increment to 100, exceeding the cap. Fixed-window only
(no sliding window).
**Why rejected**: Eventual consistency breaks the correctness guarantee a
rate limiter exists to provide.

### 2. D1 sliding window

**Pros**: SQL is a natural fit for a hit table; D1 has the same SQLite
semantics as DO storage.
**Cons**: D1 writes go through a primary region with replication. Each
check would add cross-region latency, and the per-write cost at high volume
would dwarf the DO equivalent.
**Why rejected**: D1 is for source-of-truth data; the rate limiter wants
edge-local writes that don't need to replicate.

### 3. External Redis (Upstash, Pulse, Cloudflare-adjacent edge KV)

**Pros**: Mature, well-understood, redis-cell or similar can give
millisecond sliding windows out of the box.
**Cons**: Breaks the Cloudflare-only rule from ADR-001 and
`requirements.md`. Adds a second provider, second set of credentials,
second source of latency.
**Why rejected**: Hard constraint against off-Cloudflare runtime
dependencies.

### 4. In-Worker memory counter

**Pros**: Zero infrastructure cost.
**Cons**: Worker isolates are ephemeral. State doesn't survive isolate
recycling, doesn't share across regions, doesn't share across requests
landing on different isolates within the same region. Functionally useless
as a real limiter.
**Why rejected**: Not actually a limiter.

## References

- [Plan §2.5 — `RATE_LIMITER` binding](../../instruction/work/plan.md#25-bindings-used-by-questkit-worker-api)
- [Plan amendment A5 — SQLite DO migration tag](../../instruction/work/plan.md#3-spec-amendments)
- [Plan §5 — Security: Abuse / API spamming](../../instruction/work/plan.md#5-security-considerations)
- [workers/api/src/durable/rate-limiter.ts](../../workers/api/src/durable/rate-limiter.ts)
- [Cloudflare — Durable Objects with SQL storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
- [RFC 7231 §7.1.3 — Retry-After](https://datatracker.ietf.org/doc/html/rfc7231#section-7.1.3)
