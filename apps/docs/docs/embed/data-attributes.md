---
sidebar_position: 2
title: Data Attributes
description: Every data-questkit-* attribute the embed recognises.
---

# Data Attributes

The embed reads two classes of `data-questkit-*` attributes — one set on the `<script>` tag (boot config), and one set on widget mount points (per-widget props).

## On the `<script>` tag

These configure the boot. All three are required; the embed `console.warn`s and skips auto-init if any are missing.

| Attribute                | Required | Description                                                                  |
| ------------------------ | -------- | ---------------------------------------------------------------------------- |
| `data-questkit-app-id`   | yes      | Your application identifier.                                                 |
| `data-questkit-user-id`  | yes      | The user the embed renders for.                                              |
| `data-questkit-base-url` | yes      | API base URL, no trailing slash. E.g. `https://api.questkit.jairukchan.com`. |

The JWT is **not** a script attribute — it comes from a `<meta name="questkit-token">` tag in the same document (see [Quick Start](./quick-start.md#why-the-jwt-lives-in-a-meta-tag)).

## On widget mount points

The mount point is any element with `data-questkit="<WidgetName>"`. Props are passed via `data-questkit-prop-<kebab-case-name>="<value>"`.

```html
<div
  data-questkit="MissionList"
  data-questkit-prop-campaign-id="spring-2026"
  data-questkit-prop-limit="10"
  data-questkit-prop-status="active"
></div>
```

The embed converts kebab-case attribute names to camelCase prop names: `data-questkit-prop-campaign-id` → `campaignId`. **All values arrive as strings** — components are responsible for coercing where needed.

### Per-widget reference

#### `MissionList`

| Prop attribute                   | Type     | Description                                            |
| -------------------------------- | -------- | ------------------------------------------------------ |
| `data-questkit-prop-campaign-id` | `string` | Filter to one campaign.                                |
| `data-questkit-prop-limit`       | `string` | Page size (number serialised as string).               |
| `data-questkit-prop-status`      | `string` | `active` / `completed` / `claimed` / `locked` / `all`. |

#### `MissionCard`

Presentational — typically not mounted standalone via the embed. Use `MissionList` for the data-fetching variant.

#### `CoinBalance`

| Prop attribute                | Type     | Description                               |
| ----------------------------- | -------- | ----------------------------------------- |
| `data-questkit-prop-currency` | `string` | Required. E.g. `gold`, `point`, `gem`.    |
| `data-questkit-prop-animated` | `string` | `"true"` to enable the rolling animation. |

#### `CampaignBanner`

| Prop attribute                   | Type     | Description |
| -------------------------------- | -------- | ----------- |
| `data-questkit-prop-campaign-id` | `string` | Required.   |

#### `ProgressBar`

| Prop attribute             | Type     | Description                                   |
| -------------------------- | -------- | --------------------------------------------- |
| `data-questkit-prop-value` | `string` | Required. Numeric value serialised as string. |
| `data-questkit-prop-max`   | `string` | Required. Numeric max.                        |
| `data-questkit-prop-label` | `string` | Optional accessible label.                    |

#### `RecommendedMissions`

No required props — pulls the recommendations for the current user automatically.

#### `SpinWheel`

`rewards` and `onSpin` aren't expressible as data attributes (complex types + function). Use the [imperative API](./api-reference.md#mount) to mount `<SpinWheel>` programmatically, or skip the embed and use the React variant in a React island.

#### `ScratchCard`

Same as `SpinWheel` — `prize` and `onReveal` need the imperative API.

#### `RewardClaimToastHost`

| Prop attribute                   | Type     | Description                  |
| -------------------------------- | -------- | ---------------------------- |
| `data-questkit-prop-duration-ms` | `string` | Toast duration (numeric ms). |

Mount once near the root of your page if you want toasts to appear when `window.QuestKit.claim(...)` succeeds.

## A note on Shadow DOM and props

Every mounted widget lives inside an open Shadow DOM. Host-page CSS variables on `:root` **do** cascade in (so theming via `--color-qk-*` works), but host-page class names, IDs, and document-level event listeners **do not** reach the widget's internals. This is intentional — the embed must look the same on a WordPress page, a Vue app, and a raw HTML file.
