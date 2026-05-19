---
sidebar_position: 4
title: Campaigns
description: Time-bounded grouping of missions with optional theming.
---

# Campaigns

A **Campaign** is a time-bounded grouping of missions, typically for promotions ("Spring Sale 2026", "Onboarding Week"). Campaigns let you:

- Ship a set of related missions atomically.
- Apply a consistent visual theme (`primaryColor`, banner image).
- Time-box availability via `startAt` / `endAt`.

```ts
interface Campaign {
  id: string;
  title: string;
  description: string;
  startAt: number;
  endAt: number;
  missionIds: string[];
  theme?: CampaignTheme;
  bannerUrl?: string;
}
```

## Active window

`GET /v1/campaigns` filters to campaigns where `endAt >= now` (active or upcoming, ordered by `startAt`). Pass `?include=expired` to retrieve historical campaigns for archival or replay UIs.

```text
   ┌─────── start_at ───────┐                    ┌─── end_at ───┐
   │                        │                    │              │
   │   upcoming (returned   │      active        │   expired    │
   │   if startAt > now)    │   (returned)       │  (returned   │
   │                        │                    │   only with  │
   │                        │                    │  ?include=   │
   │                        │                    │   expired)   │
   └────────────────────────┘                    └──────────────┘
                                  ▲
                                  │
                                Date.now()
```

## Composition

A campaign references missions via `missionIds`. Missions can belong to at most one campaign (the relationship lives on `Mission.campaignId`). `GET /v1/campaigns/:id?include=missions` hydrates the mission rows in one round-trip.

## Theming

`CampaignTheme.primaryColor` lets a campaign override the global `--color-qk-primary` token for the duration of its run, giving the `<CampaignBanner>` and downstream widgets a campaign-specific accent without rebuilding your app.
