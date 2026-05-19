/**
 * The embed renders into Shadow DOM, which intentionally blocks
 * document-level CSS — so we have to ship our own stylesheet alongside
 * the JS. The IIFE inlines this string into each shadow root's
 * `<style>` tag at mount time.
 *
 * Why hand-rolled instead of a `?raw` import of @questkit/react's
 * theme.css?
 *
 *   1. @questkit/react/styles.css starts with `@import "tailwindcss"`,
 *      which loads the entire Tailwind preflight (~200 KB raw, 60 KB
 *      gzipped) — that alone would blow our embed budget.
 *   2. The Tailwind utility classes our React components reference are
 *      consumed by the *host app's* Tailwind compiler at build time. The
 *      embed runs in arbitrary host pages without Tailwind, so utility
 *      classes wouldn't apply anyway.
 *   3. Our components fall back to inline `style={{...}}` for layout-
 *      critical visuals and reference CSS custom properties for colour /
 *      radius tokens. So all the embed actually needs to ship is:
 *        (a) the CSS variables (`--color-qk-primary`, etc.)
 *        (b) a tiny reset so host body styles don't bleed through the
 *            `:host` of the shadow root.
 *
 * Token values mirror packages/react/src/styles/theme.css. If the React
 * placeholder palette changes, update both — they're intentionally
 * duplicated rather than linked because the embed is a different
 * delivery channel (Tailwind-free).
 */
export const STYLES_CSS = `
:host {
  --color-qk-primary: oklch(0.62 0.18 264);
  --color-qk-bg: oklch(0.99 0.004 264);
  --color-qk-fg: oklch(0.21 0.02 264);
  --color-qk-coin: oklch(0.78 0.16 78);
  --color-qk-primary-hover: oklch(from var(--color-qk-primary) calc(l - 0.05) c h);
  --color-qk-muted: oklch(from var(--color-qk-fg) calc(l + 0.4) c h);
  --radius-qk: 0.75rem;
  --font-qk: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;

  display: block;
  color: var(--color-qk-fg);
  font-family: var(--font-qk);
  box-sizing: border-box;
}

:host *,
:host *::before,
:host *::after {
  box-sizing: border-box;
}

.qk-embed-root {
  font-family: var(--font-qk);
  color: var(--color-qk-fg);
}

@media (prefers-reduced-motion: reduce) {
  :host *,
  :host *::before,
  :host *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;
