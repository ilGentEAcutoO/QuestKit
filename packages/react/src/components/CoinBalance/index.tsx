/**
 * <CoinBalance /> — displays the user's balance for one currency.
 *
 * Subscribes via `useBalance(currency)`. When `animated` is true and the
 * underlying value changes, the displayed integer rolls from the previous
 * value to the new value over 300 ms (ease-out cubic) using
 * `requestAnimationFrame`. `prefers-reduced-motion: reduce` short-circuits
 * the animation and snaps to the new value.
 *
 * Accessibility:
 *   - The currency code is exposed via `aria-label` so screen readers say
 *     e.g. "1,250 GOLD" rather than just "1,250".
 *   - During the rolling animation, only the visual digits change — ARIA
 *     announces the final value (the live region is intentionally polite
 *     so it isn't spammy).
 */
import type { CSSProperties, ReactElement } from "react";
import { useEffect, useRef, useState } from "react";

import { useBalance } from "../../hooks/useBalance";

export interface CoinBalanceProps {
  /** Currency code (e.g. "GOLD", "POINT"). Required — list mode lives elsewhere. */
  currency: string;
  /** If true, rolls the displayed number on change. Default: false. */
  animated?: boolean;
  /** Optional className appended to the root span. */
  className?: string;
}

function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

// cubic-ease-out: 1 - (1 - t)^3
function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

export function CoinBalance({
  currency,
  animated = false,
  className,
}: CoinBalanceProps): ReactElement {
  const state = useBalance(currency);
  const real = state.data?.amount ?? 0;

  const [displayed, setDisplayed] = useState<number>(real);
  const lastTargetRef = useRef<number>(real);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // No animation requested → snap. Same for reduced-motion users.
    if (!animated || prefersReducedMotion()) {
      lastTargetRef.current = real;
      setDisplayed(real);
      return undefined;
    }
    // Already at target → nothing to do.
    if (real === lastTargetRef.current) return undefined;

    const start = lastTargetRef.current;
    const delta = real - start;
    const duration = 300; // ms
    const startTs = performance.now();
    lastTargetRef.current = real;

    const tick = (now: number): void => {
      const elapsed = now - startTs;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      const next = Math.round(start + delta * eased);
      setDisplayed(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(tick);

    return (): void => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [real, animated]);

  const containerClass = [
    "qk-coin-balance",
    "inline-flex items-center gap-1 font-medium",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // We bind the foreground colour via a custom property so jsdom (which
  // rejects var() values for parsed CSS shorthand / longhand colour) still
  // round-trips the token through `getPropertyValue`. Real browsers
  // resolve --qk-coin transparently.
  const numberStyle: CSSProperties = {
    color: "var(--qk-coin)",
    ["--qk-coin" as never]: "var(--color-qk-coin)",
    fontFamily: "var(--font-qk)",
    fontVariantNumeric: "tabular-nums",
  };

  const ariaLabel = `${displayed} ${currency}`;

  return (
    <span
      className={containerClass}
      aria-label={ariaLabel}
      aria-live="polite"
      aria-busy={state.isLoading}
      style={numberStyle}
      data-currency={currency}
    >
      <span aria-hidden="true">{displayed.toLocaleString()}</span>
      <span aria-hidden="true" className="opacity-70 text-sm">
        {currency}
      </span>
    </span>
  );
}
