---
title: ADR-006 — Test boundaries: service-layer stubs vs `cloudflare:test` pool-workers
status: Accepted
date: 2026-05-19
deciders: Bosso (@ilGentEAcutoO)
---

# ADR-006: Test boundaries — service-layer stubs vs `cloudflare:test` pool-workers

## Context

`@cloudflare/vitest-pool-workers` (0.16 at scaffold time) is the official
Vitest integration for Workers tests. It compiles the worker bundle
separately and runs the resulting code inside `workerd`, the same runtime
production Workers execute in. Test code stays in Node.js. The two halves
talk over a thin RPC bridge (`SELF.fetch`, `env`, `runInDurableObject`,
`createMessageBatch`).

This is excellent for **fidelity** — the worker that runs in the test is
the same isolate semantics that ships to production — and **terrible for
mocking**. Test code in Node.js and worker code in workerd share no module
graph. `vi.mock("../src/services/foo")` declared in a test file rewrites
the Node-side import resolution, but the worker bundle was already compiled
and shipped to workerd before the test ran. The bundle's `import` of
`../src/services/foo` resolves to the real, baked-in implementation. The
spy never fires.

Phase 3 discovered this the hard way while writing tests for
`/v1/recommendations`. The intent was: mock `recommendMissions`, drive the
route via `SELF.fetch`, assert the 200/502/503 translation logic.
**Locally** the spy appeared to work — but only because the developer had
`wrangler login` active and the AI binding was answering live requests
from Cloudflare's edge, masking the unstubbed call. **In CI**, with no
Cloudflare API token, the worker couldn't even start: Workers AI is always
remote-proxied (ADR-005, no local emulator), so the `ai` binding in
`wrangler.test.jsonc` opened a session that immediately failed
authentication.

Two lessons surfaced (plan §10.2 L1 and L2). This ADR makes them
permanent.

## Decision

A four-part rule governs all Worker tests in QuestKit.

**(a) Pure functions and services are tested at the service layer with
hand-rolled `Pick<Env, "X" | "Y">` stubs.** No `cloudflare:test`
involvement. The test file imports the function directly from `src/`,
constructs a minimal `env` shape covering only the bindings the function
uses, and asserts behaviour. Example: every Workers AI path is covered by
[`workers/api/test/ai.service.test.ts`](../../workers/api/test/ai.service.test.ts),
which builds an in-memory KV stub and an `Ai`-shaped fake whose `run` is a
`vi.fn`.

**(b) Routes are tested via `SELF.fetch()` only for paths that don't
require mockable dependencies.** Auth checks, short-circuits, and DB
queries against the real miniflare D1 all qualify. The route file for
`/v1/recommendations` is tested for: (1) 401 with no JWT, (2) 401 with
malformed JWT, (3) 200 with empty active-missions short-circuit — all
paths where `env.AI` is never reached.

**(c) Queue consumers use `createMessageBatch` + `getQueueResult` from
`@cloudflare/vitest-pool-workers/context`.** This invokes the handler
directly with a synthesised `MessageBatch` and a plain JS `env` — no
workerd boundary crossed. The webhook-consumer test
([`workers/webhook-consumer/test/queue.test.ts`](../../workers/webhook-consumer/test/queue.test.ts))
uses this pattern to assert ack/retry behaviour, backoff curves, and DLQ
routing without leaving Node.

**(d) Workers AI specifically has no local emulator, so the `ai` binding
stays out of `wrangler.test.jsonc` entirely.** AI-touching code is tested
only at the service layer. A Worker that needs the binding at runtime gets
it from the production `wrangler.jsonc`; the test config simply does not
declare it.

## Consequences

### Positive

- **Tests run in CI without Cloudflare credentials.** No
  `CLOUDFLARE_API_TOKEN` secret required, no public-repo secret-hygiene
  concerns. A fork can clone, install, and `pnpm test` immediately.
- **Coverage is preserved.** The four AI-dependent route tests dropped in
  Phase 3 (cache HIT, cache MISS, malformed response 502, outage 503) all
  have equivalent service-layer counterparts in `ai.service.test.ts`.
  Route-level coverage of the error-translation branch is small enough
  (six lines of `try/catch` in `recommendations.ts`) that inspection
  suffices.
- **Clear pattern for future workers.** A new Worker added in Phase 4+
  inherits a sanctioned recipe: pure → service-layer stub; HTTP shell →
  `SELF.fetch`; queue handler → `createMessageBatch`. New contributors
  don't have to re-derive the boundary.
- **Lower temptation to weaken test isolation.** Without this ADR, the
  next contributor hitting the `vi.mock` failure would be tempted to
  inject a CF API token into CI just to make the live binding work in
  tests — a corrosive workaround that masks behavior changes and leaks
  cost.

### Negative

- **Loss of full-route assertions for AI paths.** We cannot assert
  end-to-end that `requireAuth → load missions → call recommender → return
502 on malformed AI` works as one composed unit. We assert the parts
  individually and trust composition. Composition is six lines; the trust
  is warranted but not proven by automated test.
- **Two test files per AI-touching feature.** The route test covers auth
  - short-circuit; the service test covers the algorithm. Newcomers must
    understand why the split exists before extending either.
- **Ongoing discipline required.** Future PRs that add `vi.mock(...)` to a
  pool-workers route test will fail mysteriously. The comment block at the
  top of `recommendations.route.test.ts` documents the boundary in-source
  for exactly this reason.

### Neutral

- **The pattern is portable.** Any Worker test framework that compiles the
  bundle separately from the test code (not just `cloudflare:test`) has
  the same module-graph problem. The decision generalises beyond
  Cloudflare.

## Alternatives considered

### 1. Inject a Cloudflare API token as a CI secret to allow remote-proxy session

**Pros**: Tests run end-to-end against real `env.AI`. Less code than the
service-layer stub approach.
**Cons**: (i) Public-repo secret hygiene — every PR run would need the
secret, which means PR runs from forks fail (GitHub Actions does not
expose secrets to fork PRs). (ii) Real cost — every CI run incurs Workers
AI inference charges. (iii) Tests become non-deterministic — the LLM
response varies, breaking assertions or forcing fuzzy matching that
weakens the test. (iv) Slower CI — each AI test adds 1–3 s of inference
latency.
**Why rejected**: All four cons compound. Public-repo discipline alone is
enough.

### 2. Refactor the route to accept a recommender via env-injected service

**Pros**: Service injection unlocks `SELF.fetch` testing — the route would
receive a stub recommender through the env shape, and Hono would handle
the routing.
**Cons**: One route, one binding, one test would benefit. Twenty other
routes don't need it. The env type would grow a `RECOMMENDER` slot that
exists only for testing. Production code complexity for test convenience.
**Why rejected**: Over-engineering. The service-layer-stub pattern
provides the same coverage with zero production-code change.

### 3. Run tests in `miniflare` directly without pool-workers

**Pros**: Different isolation model that might allow module-graph mocking.
**Cons**: Loses the official Cloudflare-supported test runner.
Pool-workers is the recommended path; abandoning it for a workaround that
might not even work is the wrong trade.
**Why rejected**: Pool-workers is the right tool; the boundary it imposes
is a constraint to design around, not a bug to work around.

## References

- [Plan §10.2 L1+L2 — Phase 3 lessons learned](../../instruction/work/plan.md#10-phase-46-readiness--lessons-added-2026-05-19-2230)
- [workers/api/test/ai.service.test.ts](../../workers/api/test/ai.service.test.ts) — example service-layer stub
- [workers/api/test/recommendations.route.test.ts](../../workers/api/test/recommendations.route.test.ts) — example boundary-respecting route test
- [workers/webhook-consumer/test/queue.test.ts](../../workers/webhook-consumer/test/queue.test.ts) — example `createMessageBatch` usage
- [Cloudflare — `@cloudflare/vitest-pool-workers`](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [ADR-005 — Workers AI for personalization](./005-workers-ai-for-personalization.md) — the deprecation cycle that triggered this discovery
