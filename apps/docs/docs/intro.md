---
sidebar_position: 1
---

# QuestKit Documentation

Welcome. The full doc set lands in TASK-027 (Phase 5, Day 5). For now, this single page exists so the Docusaurus scaffold and the Tailwind v4 integration can be verified end-to-end.

## Tailwind v4 smoke test

The block below is rendered via raw HTML (Markdown allows inline HTML). If Tailwind v4 is wired correctly through the custom Docusaurus plugin, the box renders with a blue background, white text, padding, and rounded corners. If Infima wins the cascade, it falls back to plain body styling.

<div class="bg-blue-500 p-4 text-white rounded">Tailwind v4 smoke test — should be blue.</div>

## Theme tokens

QuestKit ships its design tokens via `@questkit/react/styles.css`. The `bg-qk-primary` and `text-qk-coin` utilities below come from the shared `@theme` block — the same one the demo app uses — so docs examples theme consistently with the live demo.

<div class="bg-qk-primary p-4 text-white rounded">QuestKit primary brand colour.</div>

<div class="bg-qk-coin p-4 text-qk-fg rounded mt-2">QuestKit coin / reward accent.</div>

## More to come

In the meantime, see the [README on GitHub](https://github.com/ilGentEAcutoO/QuestKit) for installation, quick-start, and architecture details.
