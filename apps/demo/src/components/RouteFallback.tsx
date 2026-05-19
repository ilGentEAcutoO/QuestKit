import type { ReactElement } from "react";

/**
 * Minimal skeleton shown while a lazy-loaded route chunk is fetched.
 *
 * Intentionally lightweight (no framer-motion, no large layout shifts) so it
 * doesn't churn Lighthouse's CLS score during the transient render.
 */
export function RouteFallback(): ReactElement {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading scenario"
      className="flex min-h-[40dvh] flex-col items-center justify-center gap-3 text-sm"
      style={{ color: "var(--color-demo-muted)" }}
    >
      <span
        aria-hidden="true"
        className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent"
      />
      <span>Loading…</span>
    </div>
  );
}
