---
sidebar_position: 1
title: Quick Start
description: Drop QuestKit into any HTML page in three tags.
---

# Embed Quick Start

The vanilla embed is one IIFE bundle. Add a `<meta>` tag for the JWT, a widget mount point, and a `<script>` tag with three data attributes. No build step, no framework.

## Minimal page

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />

    <!-- Required: pre-minted JWT for the current user.
         The embed can't safely receive the secret to mint its own —
         your backend mints, your page injects. -->
    <meta name="questkit-token" content="<JWT from your backend>" />
  </head>
  <body>
    <h1>My App</h1>

    <!-- Widget mount points. Each renders inside an isolated Shadow DOM. -->
    <div data-questkit="MissionList" data-questkit-prop-limit="5"></div>

    <div data-questkit="CoinBalance" data-questkit-prop-currency="gold"></div>

    <!-- Embed bundle. The three data-questkit-* attrs are required. -->
    <script
      src="https://play.questkit.jairukchan.com/questkit.iife.js"
      data-questkit-app-id="your-app-id"
      data-questkit-user-id="usr_demo_123"
      data-questkit-base-url="https://api.questkit.jairukchan.com"
    ></script>
  </body>
</html>
```

## How it boots

1. The `<script>` tag loads. The bundle captures `document.currentScript` immediately so it can read the `data-questkit-*` attrs (`document.currentScript` is `null` by the time `DOMContentLoaded` fires).
2. The bundle constructs a `QuestKitClient` using the script attrs + the JWT from `<meta name="questkit-token">`.
3. On `DOMContentLoaded` (or immediately if already loaded), it scans the DOM for `[data-questkit="<Widget>"]` elements.
4. Each match is mounted inside a Shadow DOM (`shadow-root` attached to the host element).
5. `window.QuestKit` is assigned the imperative API — `fireEvent`, `claim`, `mount`, `unmount`, `on`, `off`.

## Why the JWT lives in a `<meta>` tag

The embed runs in the browser. Shipping `APP_SECRET` to the browser to mint tokens client-side would expose it to every visitor — so the embed deliberately doesn't support that. Your backend handles the `POST /v1/auth/token` exchange and injects the resulting short-lived JWT into the page (server-rendered meta tag, or a cookie + small script). The embed reads it once at boot.

For the playground and demo pages, the JWT is injected by a tiny serverless handler at request time.

## Widget whitelist

The embed can mount these widgets by name:

- `MissionList`
- `MissionCard`
- `CoinBalance`
- `CampaignBanner`
- `ProgressBar`
- `RecommendedMissions`
- `SpinWheel`
- `ScratchCard`
- `RewardClaimToastHost`

Unknown widget names are skipped with a `console.warn`.

See the [Data Attributes](./data-attributes.md) reference for the full list of `data-questkit-prop-*` overrides, and [API Reference](./api-reference.md) for the `window.QuestKit` imperative surface.
