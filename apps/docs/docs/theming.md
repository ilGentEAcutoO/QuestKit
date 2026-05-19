---
sidebar_position: 3
title: Theming
description: Every CSS variable QuestKit ships, what it controls, and how to override it.
---

# Theming

QuestKit's design tokens live in a single Tailwind v4 `@theme` block in `@questkit/react/styles.css`. Every component reads from these CSS variables — override them and the whole library re-themes. No `tailwind.config.js`, no runtime theme switcher dependency.

## Token table

| Variable                   | Default                                                  | Description                                                                                                           | Example override               |
| -------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `--color-qk-primary`       | `oklch(0.62 0.18 264)` (indigo)                          | Main brand accent. Used for CTAs (`<Claim>` button), focus rings, `<ProgressBar>` fill, `<CampaignBanner>` countdown. | `oklch(0.62 0.20 30)` (coral)  |
| `--color-qk-bg`            | `oklch(0.99 0.004 264)` (near-white)                     | Surface background. Component cards (`<MissionCard>`, `<CampaignBanner>`, `<RewardClaimToast>`) use this.             | `oklch(0.18 0.01 264)` (dark)  |
| `--color-qk-fg`            | `oklch(0.21 0.02 264)` (near-black)                      | Foreground / body text. Should pass AA contrast on `--color-qk-bg`.                                                   | `oklch(0.95 0.01 264)` (light) |
| `--color-qk-coin`          | `oklch(0.78 0.16 78)` (amber)                            | Gamification reward accent. `<CoinBalance>` number colour, mission reward badge background, toast accent badge.       | `oklch(0.84 0.18 100)` (lemon) |
| `--color-qk-primary-hover` | `oklch(from var(--color-qk-primary) calc(l - 0.05) c h)` | Auto-derived darker primary for hover/active states.                                                                  | _(usually leave as derived)_   |
| `--color-qk-muted`         | `oklch(from var(--color-qk-fg) calc(l + 0.4) c h)`       | Auto-derived muted track / border colour. `<ProgressBar>` track, card borders, `<MissionList>` skeleton background.   | _(usually leave as derived)_   |
| `--radius-qk`              | `0.75rem`                                                | Border-radius applied to cards, banner, buttons, badges, toasts.                                                      | `0.25rem` (squarer)            |
| `--font-qk`                | `"Inter", ui-sans-serif, system-ui, ...`                 | Font stack used by every QuestKit widget.                                                                             | `"Roboto Mono", monospace`     |

## Overriding

Add a `@theme` (or plain `:root`) block **after** the QuestKit import:

```css
/* app.css */
@import "@questkit/react/styles.css";

@theme {
  --color-qk-primary: oklch(0.65 0.18 280);
  --color-qk-coin: oklch(0.85 0.16 60);
  --radius-qk: 0.25rem;
  --font-qk: "JetBrains Mono", monospace;
}
```

## Dark mode

```css
[data-theme="dark"] {
  --color-qk-bg: oklch(0.18 0.01 264);
  --color-qk-fg: oklch(0.95 0.01 264);
  --color-qk-muted: oklch(0.4 0.02 264);
}
```

Toggle by setting `document.documentElement.dataset.theme = "dark"`. Components re-render visually on the next paint — no JS state coupling.

## Campaign-scoped overrides

A `Campaign.theme.primaryColor` value (in the API response) is a CSS color you can apply via inline style for the duration of a campaign's UI:

```tsx
const { data } = useCampaign("spring-2026");
const themeStyle = data?.campaign.theme?.primaryColor
  ? { ["--color-qk-primary" as string]: data.campaign.theme.primaryColor }
  : undefined;

return (
  <div style={themeStyle}>
    <CampaignBanner campaignId="spring-2026" />
  </div>
);
```

## Reduced motion

QuestKit's stylesheet includes a global guard so animations short-circuit when the user prefers reduced motion:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
```

Individual components (`<CoinBalance>`'s rolling number, `<SpinWheel>`'s rotation, `<ScratchCard>`'s reveal) also branch internally to skip animation logic entirely under reduced motion — they don't just shorten the timing.
