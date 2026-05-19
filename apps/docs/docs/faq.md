---
sidebar_position: 5
title: FAQ
description: Frequently asked questions.
---

# FAQ

## Why React if you're a Vue dev?

I am a Vue developer. The job description that motivated QuestKit calls for React. So this project is, openly, a cross-framework competency demonstration — not an attempt to pretend Vue isn't my daily driver.

The pragmatic answer is that the React component layer in `@questkit/react` is the **thin** part of the stack. It's a handful of hooks subscribing to a framework-agnostic `QuestKitClient` and a set of presentational widgets that read CSS variables. The heavy lifting — the rule engine, the SSE client with reconnect, the event queue with at-least-once delivery, the JWT plumbing, the Workers AI prompt construction, the HMAC verification, the queue/DLQ pipeline — lives in `@questkit/core` and the API Worker. None of that is React. A Vue port (or Solid, or Svelte, or vanilla) would reuse the entire core SDK and reimplement only the surface — a couple of provider components, a few `ref`-based hooks, and the same JSX-shaped widgets in template syntax.

That port is on the v0.2 roadmap. If you're a Vue shop and want to use QuestKit, the path forward is `@questkit/vue` against the same Worker API and the same `@questkit/core` event/SSE plumbing — no architectural changes required. Picking React for v0.1 was a deliberate choice to prove the project against the JD's stated requirements; isolating that choice to the thinnest layer of the stack is a deliberate choice to keep the rest of the codebase framework-neutral.

---

## Is QuestKit production-ready?

For low-to-medium-traffic workloads on Cloudflare's free tier: yes — strict TypeScript, ≥ 60% coverage on packages, ≥ 70% on the rule engine, real Workers tests via `@cloudflare/vitest-pool-workers`, Newman contract tests, gitleaks in CI, SonarCloud quality gate.

For high-scale enterprise workloads: it'll be production-ready when v0.2 lands (leaderboards, A/B-testable mission ramps, fan-out via Hyperdrive, multi-region D1).

## Is it really Cloudflare-only?

Yes. The hard rule of the project is that **every runtime URL terminates at a Cloudflare Worker**. Six Workers total, every binding is a CF binding, no Vercel/Netlify/Supabase/Auth0 anywhere. The only non-CF dependencies are build-time / dev-time: GitHub for hosting, GitHub Actions for CI, SonarCloud for static analysis, npm for package publishing, Postman/Newman for API contract tests.

## Why not WebSockets for realtime?

SSE is simpler, works through every corporate proxy, and matches the use case (server-pushes-to-client, no bidirectional traffic). The full reasoning is in ADR-003 in the repo's `docs/decisions/`.

## Can I use it without React?

Yes — the vanilla embed at [`@questkit/embed`](./embed/quick-start.md) is one IIFE bundle that mounts widgets via `data-questkit="<Widget>"` attributes. No build step, no framework. The embed still ships React internally (Shadow-DOM-isolated), so the bundle size is around 200 KB gzipped — not pixel-thin, but acceptable for an embed.

## How do I customise the look?

Override the CSS variables from the [Theming](./theming.md) page. Every widget reads from `--color-qk-*` / `--radius-qk` / `--font-qk` — overrides cascade transparently into the Shadow DOM of the vanilla embed too.

## Is the AI recommendation feature optional?

Yes. If `/v1/recommendations` is unreachable (binding error, model outage, your CF account doesn't have Workers AI enabled), the React `<RecommendedMissions>` widget renders an empty state — it doesn't break the rest of the UI. Inferences cost nothing on the free tier within the standard limits.

## Where do I file bugs / feature requests?

[GitHub Issues](https://github.com/ilGentEAcutoO/QuestKit/issues). Bug reports with reproduction steps and feature requests with use-case context are most welcome. Note this is a portfolio project — PRs welcome but no SLA on responses.

## License?

MIT. Fork freely.
