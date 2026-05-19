---
sidebar_position: 5
title: Personalization
description: AI-curated mission recommendations powered by Workers AI.
---

# Personalization

QuestKit surfaces personalized mission recommendations through `GET /v1/recommendations`. The endpoint runs Llama 3.1 8B (the Cloudflare `@cf/meta/llama-3.1-8b-instruct-fast` model) inside the same Worker that serves the rest of the API — no external AI vendor, no extra round-trip.

```text
   ┌─────────────────────────────────────────────────────────┐
   │  /v1/recommendations (auth required)                    │
   └─────────┬───────────────────────────────────────────────┘
             │
             ▼
   ┌────────────────────┐    cache hit    ┌────────────────────┐
   │  KV cache lookup   │ ──────────────► │  return (cached)   │
   │  key = userId      │                 └────────────────────┘
   └─────────┬──────────┘
             │ miss
             ▼
   ┌────────────────────┐
   │ Load context       │
   │  • last 50 events  │
   │  • active missions │
   └─────────┬──────────┘
             │
             ▼  empty?  ──yes──► empty result, no AI call
             │ no
             ▼
   ┌────────────────────┐
   │ Workers AI         │
   │  Llama 3.1 8B fast │
   └─────────┬──────────┘
             │
             ▼
   ┌────────────────────┐
   │ Filter hallucinated│
   │ mission IDs        │
   └─────────┬──────────┘
             │
             ▼
   ┌────────────────────┐
   │ KV cache write     │
   │ (1 hour TTL)       │
   └─────────┬──────────┘
             │
             ▼
        return result
```

## What goes into the prompt

- The user's most recent 50 events (`name`, `timestamp`, optional payload summary)
- The user's `active` and `completed` (unclaimed) missions

**No free-text user input is forwarded to the LLM.** Only structured event metadata — protecting against prompt-injection from event payloads.

## What comes out

```ts
interface RecommendationsResponse {
  missionIds: string[]; // hallucinated IDs filtered out
  reason: string; // one-sentence "why" surfaced in the UI
  cached: boolean; // true when served from KV
  count: number; // = missionIds.length
}
```

`reason` is rendered next to the recommendations panel as a subtle italic caption ("You've been on a checkout streak — try the Express Buyer mission"). It's not authoritative copy; treat it like a hint.

## Cost & freshness

- Cached for 1 hour per `userId`.
- An empty active-missions list short-circuits without an inference (saves the round-trip).
- Free-tier Workers AI quotas comfortably cover demo and low-traffic production workloads.

See [API → /v1/recommendations](../api/recommendations.md) for the wire format.
