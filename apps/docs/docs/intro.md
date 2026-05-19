---
slug: /
sidebar_position: 1
title: QuestKit
description: Cloudflare-native gamification SDK — missions, rewards, balance, AI recommendations in one drop-in script.
---

# QuestKit

**Cloudflare-native gamification SDK.** One bundle drops gamification widgets — missions, rewards, balance, AI recommendations — into any React app or any HTML page.

- [Live demo](https://questkit.jairukchan.com)
- [Embed playground](https://play.questkit.jairukchan.com)
- [GitHub](https://github.com/ilGentEAcutoO/QuestKit)

## What you ship

- A typed REST API for events, missions, balances, campaigns, and AI recommendations
- A React component library (`@questkit/react`) with hooks and pre-built widgets
- A vanilla JS embed (`@questkit/embed`) that mounts widgets via `data-*` attributes on any HTML page
- Real-time updates over Server-Sent Events with automatic polling fallback
- Inbound webhooks with HMAC verification and at-least-once Queue delivery
- AI-curated mission recommendations powered by Workers AI
- Mini-game widgets (spin wheel, scratch card) with cooldown + reduced-motion support

## Architecture in one diagram

```text
                ┌─────────────────────────────────────┐
                │  React app  /  HTML page  /  iframe │
                │   @questkit/react · @questkit/embed │
                └────────────┬────────────────────────┘
                             │ HTTPS · SSE · JWT
                             ▼
   ┌─────────────────────────────────────────────────────────┐
   │           questkit-worker-api (Hono on Workers)         │
   │   /v1/auth · /v1/events · /v1/missions · /v1/balance    │
   │   /v1/campaigns · /v1/sse · /v1/recommendations         │
   └──┬──────────┬──────────┬─────────────┬─────────────┬────┘
      │          │          │             │             │
      ▼          ▼          ▼             ▼             ▼
   ┌────┐    ┌────┐   ┌─────────┐   ┌───────────┐  ┌───────┐
   │ D1 │    │ KV │   │ R2      │   │ DO        │  │ AE    │
   │    │    │    │   │ assets  │   │ RateLim   │  │ Events│
   └────┘    └────┘   └─────────┘   │ SSEHub    │  └───────┘
                                    └───────────┘
                                                       ▲
   external POST (Stripe etc.) ──┐                     │ Workers AI
                                 ▼                     │ (Llama 3.1 8B fast)
                  ┌──────────────────────────┐         │
                  │ questkit-worker-         │         │
                  │   webhook-relay          │  RPC    │
                  │  HMAC verify + Queue     │ ──────► │
                  └─────────┬────────────────┘   │     │
                            │                    │     │
                            ▼                    │     │
                  questkit-queue-webhooks ───────┘     │
                            │                          │
                            ▼                          │
                  ┌──────────────────────────┐         │
                  │ questkit-worker-         │         │
                  │   webhook-consumer       │ RPC ────┘
                  │  exp-backoff · DLQ@5     │
                  └──────────────────────────┘
```

Every URL terminates at a Cloudflare Worker — six Workers, zero non-CF runtime services.

## Choose your path

- **React app?** Jump to [Getting Started → React](./getting-started.md#30-second-react-quick-start).
- **Vanilla HTML?** Jump to [Getting Started → Embed](./getting-started.md#30-second-embed-quick-start).
- **Wiring webhooks?** See [Webhooks → Overview](./webhooks/overview.md).
- **Self-hosting on your own CF account?** See [Self-Hosting](./self-hosting.md).
- **Why React if the author is a Vue dev?** [FAQ has an honest answer](./faq.md#why-react-if-youre-a-vue-dev).
