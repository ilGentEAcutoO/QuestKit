---
title: ADR-002 — React, not Vue
status: Accepted
date: 2026-05-19
deciders: Bosso (@ilGentEAcutoO)
---

# ADR-002: React, not Vue

## Context

I am a Vue developer. Most of my production work over the last several years
has been Vue 3 + Nuxt on Cloudflare. The job description that motivated
QuestKit asked specifically for React + TypeScript on the frontend. The
honest options were: (a) write the project in Vue and hope nobody minded,
(b) write the project in React even though I would learn parts of it as I
went, or (c) write both and double the surface area.

The audience for this repo includes recruiters who will skim the README, and
senior engineers who will drill into the component code. Option (a) would
have looked evasive; option (c) would have looked unfocused. Option (b) is
honest about the gap and demonstrates that I can ship production-grade React
on demand — which is the actual question the job description was asking.

A secondary consideration: QuestKit is an **embeddable SDK**, and most of the
gamification logic (rule engine, event queue, SSE reconnect, idempotency,
caching) is framework-agnostic. The framework-specific surface only needs to
cover the hooks and components — meaning the React commitment is bounded.

## Decision

`@questkit/react` is the React-specific framework binding. Peer dependency is
`react: "^18.3 || ^19"`, dev-dependency pinned at `18.3.1`. The package
exports a `QuestKitProvider` plus a small set of hooks (`useMissions`,
`useMission`, `useBalance`, `useEvent`, `useCampaign`, `useRecommendations`)
and components (`MissionList`, `MissionCard`, `CoinBalance`, `CampaignBanner`,
`RewardClaimToast`, `ProgressBar`, `SpinWheel`, `ScratchCard`,
`RecommendedMissions`).

Everything that does not require React lives in `@questkit/core` and
`@questkit/types`, which are pure TypeScript. The React layer is intentionally
thin: it wraps the core client in a Provider, exposes the hook surface, and
ships a Tailwind v4 `@theme`-driven set of components. A Vue port would be a
mechanical exercise — wrap the same `QuestKitClient` in a Vue plugin and
expose composables with the same names.

## Consequences

### Positive

- **Cross-framework demonstrated.** A Vue developer shipped a React widget
  library with 123 RTL tests passing (Phase 3 close-out). That is a real
  signal, not a claim.
- **Narrow port surface.** Because the React layer only touches state binding
  and rendering, a future `@questkit/vue` (or `@questkit/svelte`, or web
  components) needs ~600 lines, not 4,000.
- **Hook semantics match the gamification mental model.** Mission progress,
  balance updates, and campaign state are inherently subscriptions — and
  hooks compose subscriptions well.
- **JD compliance.** The job description asked for React. The portfolio piece
  delivers React.

### Negative

- **Bundle weight.** React + ReactDOM contributes roughly 45 KB gzipped to a
  hosting application that wasn't already paying for it. For the React peer
  case (i.e. the host is already running React), this is zero cost. For the
  `@questkit/embed` IIFE case, the embed bundle ships its own copy — keeping
  the embed under the 200 KB gzipped budget is a deliberate Phase 4 concern
  (TASK-020).
- **Honesty cost in interviews.** "Why React if you're a Vue dev?" is a
  question I now have to answer in technical interviews. The answer is the
  one in this ADR; the FAQ entry in the docs (TASK-027) covers the same
  ground for recruiters who skim.

### Neutral

- **React 18+19 peer range.** Plan amendment A13 widened the peer-dep from
  the spec's "React 18" to `^18.3 || ^19` because the React 19 stable was
  current at scaffold time and a v0.1.0 SDK should not artificially exclude
  hosts already on the newer major.

## Alternatives considered

### 1. Vue 3 + Composition API

**Pros**: It is the framework I write fastest in. The Composition API maps
cleanly onto the subscription-style state QuestKit deals in.
**Cons**: Does not match the JD. The portfolio piece would have answered the
wrong question.
**Why rejected**: The JD asked for React. Building it in Vue would be a
non-sequitur on a resume aimed at a React role.

### 2. Solid.js

**Pros**: Smaller bundle, finer-grained reactivity, very pleasant DX.
**Cons**: Not in the JD. Smaller ecosystem of test tooling and component
libraries to draw on.
**Why rejected**: Doesn't answer the JD question and would force a
"What's Solid?" conversation in every interview round.

### 3. Framework-agnostic web components

**Pros**: One component library that runs in any host framework.
**Cons**: Shadow DOM styling friction; awkward to compose into a host React
app where the team wants to import a `<MissionCard>` not register a custom
element; testing story is weaker than RTL.
**Why rejected**: Web components are the right answer for the `@questkit/embed`
IIFE bundle (Shadow DOM isolation buys us host-CSS protection), but for the
first-party React package, hooks beat custom elements for ergonomics.

## References

- [Plan amendment A13 — React peer range](../../instruction/work/plan.md#3-spec-amendments)
- [Plan §2.4 — Toolchain pinned versions](../../instruction/work/plan.md#24-toolchain-pinned)
- [packages/react/package.json](../../packages/react/package.json)
- [Original spec — Locked-In Tech Decisions](../../instruction/instruction.md)
