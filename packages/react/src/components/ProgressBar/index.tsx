/**
 * <ProgressBar /> — accessible, theme-driven horizontal progress meter.
 *
 * Semantics:
 *   - `role="progressbar"` + `aria-valuenow` / `aria-valuemin` / `aria-valuemax`
 *     so assistive tech announces percentages correctly.
 *   - An optional `label` is connected via `aria-label` (when no visible
 *     label exists) or as a visible text node above the bar (when provided
 *     as a string with a visible-by-default position).
 *
 * Styling:
 *   - Uses the Tailwind v4 `@theme` tokens (`--color-qk-primary` for the
 *     fill, `--color-qk-muted` for the track, `--radius-qk` for rounding).
 *   - The fill width is set via inline `style.width` because Tailwind has
 *     no class for arbitrary percentages at runtime; the value is
 *     computed once per render from `value / max`.
 *
 * Edge cases:
 *   - `max <= 0` is clamped to 1 to avoid division-by-zero NaN width.
 *   - `value` is clamped to `[0, max]` so a server returning >100% (race
 *     between SSE and refetch) doesn't break layout.
 */
import type { CSSProperties, ReactElement } from "react";

export interface ProgressBarProps {
  /** Current numeric value. Clamped to [0, max]. */
  value: number;
  /** Upper bound. Clamped to a minimum of 1 to avoid divide-by-zero. */
  max: number;
  /** Optional accessible label (read by screen readers via aria-label). */
  label?: string;
  /** Optional className appended to the container. */
  className?: string;
}

export function ProgressBar({
  value,
  max,
  label,
  className,
}: ProgressBarProps): ReactElement {
  const safeMax = max > 0 ? max : 1;
  const safeValue = value < 0 ? 0 : value > safeMax ? safeMax : value;
  const percent = (safeValue / safeMax) * 100;

  // We expose the colour as a custom property so consumers can override
  // it via CSS (`.qk-progressbar-fill { background: var(--qk-fill); }`)
  // and so tests can read it without jsdom rejecting `var()` in
  // longhand colour properties.
  const fillStyle: CSSProperties = {
    width: `${percent}%`,
    backgroundColor: "var(--qk-fill)",
    ["--qk-fill" as never]: "var(--color-qk-primary)",
    transition: "width 200ms ease-out",
  };

  const trackStyle: CSSProperties = {
    backgroundColor: "var(--qk-track)",
    ["--qk-track" as never]: "var(--color-qk-muted, rgba(0,0,0,0.08))",
    borderRadius: "var(--radius-qk)",
  };

  const containerClass = [
    "qk-progressbar",
    "relative w-full h-2 overflow-hidden",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  // aria-label is only set when a label was provided AND the component is
  // not visually labelled elsewhere. In practice the parent component
  // (e.g. MissionCard) supplies the descriptive text in its own DOM, so
  // we only forward `label` to ARIA — we don't render it visibly here.
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(safeValue)}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      {...(label !== undefined ? { "aria-label": label } : {})}
      className={containerClass}
      style={trackStyle}
    >
      <div
        className="qk-progressbar-fill h-full"
        style={fillStyle}
        aria-hidden="true"
      />
    </div>
  );
}
