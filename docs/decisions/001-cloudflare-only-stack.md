---
title: ADR-001 — Cloudflare-only stack
status: Accepted
date: 2026-05-19
deciders: Bosso (@ilGentEAcutoO)
---

# ADR-001: Cloudflare-only stack

## Context

QuestKit is a public open-source gamification SDK built primarily as a portfolio
artifact for a Senior Full-Stack role whose job description explicitly listed
Cloudflare Workers + Hono + React. The runtime side of the project therefore
needed a unified, demonstrable stack that signalled "this engineer has built
real workloads on Cloudflare" rather than "this engineer can wire any cloud
together when the docs are open." A diffuse multi-cloud topology — Workers for
the API, Vercel for the demo, Supabase for the database, Auth0 for tokens —
would have made the project resemble a checklist of trends instead of a single
coherent system.

A second constraint came from the project owner during Phase 1: a verbatim
instruction that the static-asset surfaces (`apps/demo`, `apps/docs`,
`apps/playground`) must ship as Workers, not as Cloudflare Pages. The reason
was symmetry — every URL terminating at the same compute primitive, deployed
through the same `wrangler deploy` flow, observable through the same dashboard.
Pages would have introduced a parallel deploy path, a separate set of
limits, and a different account section.

The decision had to be made before Phase 1 scaffolding because it affects
naming, CI workflow structure, custom-domain routing, and every per-Worker
`wrangler.jsonc`.

## Decision

Every URL terminates at a Cloudflare Worker. No Vercel, no Supabase, no Neon,
no Auth0, no external runtime. The topology is six Workers behind one custom
domain (plan §2.1): `questkit-worker-api` (REST + SSE + DOs + AI + D1 + KV +
R2 + Analytics Engine), `questkit-worker-demo`, `questkit-worker-docs`,
`questkit-worker-play`, `questkit-worker-webhook-relay`, and
`questkit-worker-webhook-consumer`. The three static-asset Workers ship a
bundled `dist/` directory served via the `[assets]` binding (Workers Static
Assets, GA since late 2024).

Every binding is a first-party Cloudflare resource: D1 for relational data,
KV for short-TTL caches (idempotency, JWT denylist, AI recommendation cache),
R2 for badge icons and exports, Durable Objects for per-user rate limiting
and SSE fanout, Queues for the webhook fan-out pipeline, Analytics Engine for
the metrics dataset, and Workers AI for the recommender. Secrets are managed
exclusively via `wrangler secret put`. The full binding map lives in plan §2.5.

## Consequences

### Positive

- **Single coherent narrative.** A senior engineer reviewing the repo sees one
  provider's primitives stitched into one product — that reads as depth, not
  breadth.
- **One deploy flow.** A single `.github/workflows/deploy-workers.yml` (plan
  amendment A19) handles all six Workers via a turbo-filtered matrix. One CI
  pipeline, one cost model, one set of credentials.
- **Uniform observability.** Every Worker has `observability: { enabled: true }`
  in its config; logs, errors, and tail traces converge in one dashboard.
- **Predictable cost ceiling.** The project fits inside Cloudflare's free tier
  at the volumes expected during demo-only operation. Beyond that, the Workers
  Paid plan at $5/month covers the whole topology.
- **Self-hosting story.** A forker only needs one provider account
  (`docs/SELF_HOSTING.md`). The "10-minute deploy" promise in
  `requirements.md` is feasible because there are no cross-provider DNS or
  IAM steps.

### Negative

- **Vendor lock-in.** Every primitive is Cloudflare-specific. Migrating off
  the platform would require rewriting the Durable Objects, the D1 schema,
  the Queue semantics, the Workers AI binding, and the static-asset surfaces.
  This is acknowledged and accepted — the project is a Cloudflare portfolio
  piece by design.
- **Free-tier ceiling at scale.** Heavy SSE traffic or sustained Workers AI
  inference will exceed free-tier limits. The project is not currently
  positioned for production scale; if that changed, the cost model would need
  re-validation against the Paid plan's per-request pricing.
- **Some primitives lack local emulation.** Workers AI (ADR-005) has no local
  emulator, which forced a test-boundary decision documented in ADR-006.

### Neutral

- **Static apps as Workers, not Pages.** The Workers Static Assets binding is
  GA and supported, but the choice cost roughly two hours of Phase 1 research
  to map Pages-style `_routes.json` thinking onto the
  `assets.not_found_handling: "single-page-application"` shape.

## Alternatives considered

### 1. Workers + Pages split (the obvious default)

**Pros**: Pages has slightly better DX for static sites (preview deploys per
PR baked in, `_redirects` file support, `_headers` file support).
**Cons**: Two deploy flows, two dashboards, separate per-project limits, and
the topology stops being uniform.
**Why rejected**: The project owner's Phase 1 instruction was explicit
("Workers only, no Pages"). Pages would also dilute the architecture story —
"static on Pages, dynamic on Workers" is the boilerplate every Cloudflare
tutorial shows; "everything on Workers via Static Assets" is the 2026 best
practice the project is explicitly demonstrating.

### 2. Workers + Vercel (or Netlify) for the demo

**Pros**: Vercel's preview environments are excellent; React + Vite ship
particularly well there.
**Cons**: Defeats the Cloudflare-native narrative immediately. Two providers
to provision, two dashboards, two billing accounts, two DNS configurations.
**Why rejected**: The Cloudflare-only constraint in `requirements.md` is
treated as a hard rule. The portfolio value of a unified stack outweighs the
slightly better DX Vercel might have offered for the demo.

### 3. Self-host on a Cloudflare-adjacent runtime (Bun or Deno on a VPS)

**Pros**: Full control over the runtime, no cold starts beyond container
start, no per-request pricing.
**Cons**: Operational burden (SSL, autoscaling, logging, patching), cost
floor of a running VPS, and again — kills the "Cloudflare-native" narrative.
**Why rejected**: Defeats both the cost goal and the platform-mastery goal.

## References

- [Plan §2 — Architecture](../../instruction/work/plan.md#2-architecture)
- [Plan §2.1 — Deployment topology](../../instruction/work/plan.md#21-deployment-topology--workers-only)
- [Plan amendment A1 — Workers Static Assets](../../instruction/work/plan.md#3-spec-amendments)
- [Requirements — Cloudflare-only constraint](../../instruction/work/requirements.md)
- [Cloudflare Workers Static Assets — official docs](https://developers.cloudflare.com/workers/static-assets/)
