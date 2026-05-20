/**
 * Shared inline-SVG icons for the demo app. Replaces emoji glyphs that
 * render inconsistently across OS font stacks (Windows = gray pixelated,
 * macOS = full color, Linux = whatever the distro ships). The SVGs use
 * the brand OKLCH palette so the demo's coin/badge/item visuals match
 * the social-preview card and the demo's CSS `--color-qk-*` tokens.
 */
import type { ReactElement } from "react";

/** Gold coin — used in the header balance pill and the currency reward toast. */
export function CoinIcon({ size = 18 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="qk-coin-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(0.88 0.16 95)" />
          <stop offset="100%" stopColor="oklch(0.62 0.16 65)" />
        </linearGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="10"
        fill="url(#qk-coin-grad)"
        stroke="oklch(0.45 0.14 60)"
        strokeWidth="0.6"
      />
      <circle
        cx="12"
        cy="12"
        r="7.4"
        fill="none"
        stroke="oklch(0.45 0.14 60 / 0.45)"
        strokeWidth="0.6"
      />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        fontSize="11"
        fontWeight="800"
        fill="oklch(0.32 0.12 55)"
      >
        ¢
      </text>
    </svg>
  );
}

/** Trophy badge — used in the badge reward toast. */
export function BadgeIcon({ size = 18 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="qk-badge-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.78 0.16 78)" />
          <stop offset="100%" stopColor="oklch(0.58 0.18 50)" />
        </linearGradient>
      </defs>
      {/* Trophy cup */}
      <path
        d="M6 4 H18 V8 A6 6 0 0 1 12 14 A6 6 0 0 1 6 8 Z"
        fill="url(#qk-badge-grad)"
        stroke="oklch(0.40 0.16 50)"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
      {/* Side handles */}
      <path
        d="M6 6 H3 V9 A2 2 0 0 0 5 11"
        fill="none"
        stroke="oklch(0.40 0.16 50)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 6 H21 V9 A2 2 0 0 1 19 11"
        fill="none"
        stroke="oklch(0.40 0.16 50)"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Star */}
      <path
        d="M12 6.5 L13 8.5 L15.2 8.8 L13.6 10.3 L14 12.5 L12 11.4 L10 12.5 L10.4 10.3 L8.8 8.8 L11 8.5 Z"
        fill="oklch(0.30 0.10 50)"
      />
      {/* Stand */}
      <rect
        x="10"
        y="14"
        width="4"
        height="3"
        fill="oklch(0.40 0.16 50)"
        rx="0.4"
      />
      <rect
        x="7"
        y="17"
        width="10"
        height="2"
        fill="oklch(0.32 0.14 50)"
        rx="0.6"
      />
    </svg>
  );
}

/** Wrapped gift box — used in the item reward toast. */
export function GiftIcon({ size = 18 }: { size?: number }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="qk-gift-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.62 0.20 320)" />
          <stop offset="100%" stopColor="oklch(0.48 0.20 305)" />
        </linearGradient>
      </defs>
      {/* Box body */}
      <rect
        x="3.5"
        y="9.5"
        width="17"
        height="10"
        fill="url(#qk-gift-grad)"
        stroke="oklch(0.32 0.18 310)"
        strokeWidth="0.6"
        rx="0.8"
      />
      {/* Lid */}
      <rect
        x="2.5"
        y="7"
        width="19"
        height="3"
        fill="oklch(0.55 0.20 315)"
        stroke="oklch(0.32 0.18 310)"
        strokeWidth="0.6"
        rx="0.6"
      />
      {/* Vertical ribbon */}
      <rect x="11" y="7" width="2" height="13" fill="oklch(0.88 0.10 95)" />
      {/* Bow loops */}
      <path
        d="M12 7 C10 5 8 4 8 6 C8 7 10 7 12 7 Z"
        fill="oklch(0.88 0.12 95)"
        stroke="oklch(0.55 0.16 85)"
        strokeWidth="0.4"
      />
      <path
        d="M12 7 C14 5 16 4 16 6 C16 7 14 7 12 7 Z"
        fill="oklch(0.88 0.12 95)"
        stroke="oklch(0.55 0.16 85)"
        strokeWidth="0.4"
      />
      {/* Bow knot */}
      <circle cx="12" cy="6.6" r="1.1" fill="oklch(0.78 0.16 78)" />
    </svg>
  );
}
