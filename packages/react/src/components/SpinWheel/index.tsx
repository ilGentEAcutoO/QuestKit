import type { Reward } from "@questkit/types";
/**
 * <SpinWheel /> — a circular, weighted, daily-spin reward wheel.
 *
 * SVG slices are laid out around the unit circle using polar coordinates;
 * each slice is a sector `M cx,cy L x1,y1 A r,r 0 0,1 x2,y2 Z`. A pointer
 * triangle sits above the wheel and indicates the winning slice as the
 * wheel rotates underneath it.
 *
 * **Why SVG (and not Canvas or CSS conic-gradient)?**
 *   - SVG slices are independent DOM elements: we can label each one with
 *     real text and let the wheel rotate as a single transformed `<g>`.
 *   - Accessible: each slice can carry an `<title>` for assistive tech.
 *   - The rotation transform animates cheaply via the compositor when
 *     using CSS `transform: rotate(...)`.
 *
 * **Spin algorithm:**
 *   1. Pick the winning index via weighted reservoir using
 *      `crypto.getRandomValues()` (better entropy than Math.random and
 *      demonstrable for the QuestKit demo).
 *   2. Compute the *target rotation* so that, after the animation settles,
 *      the centre of the winning slice sits directly under the pointer
 *      (which is fixed at angle = -90° in our coordinate system, i.e. the
 *      top of the wheel).
 *   3. Add `spinsExtra * 360` so the wheel makes several full revolutions
 *      before landing — that's what sells the "spin" feeling.
 *
 * **Cooldown:**
 *   Persisted in `localStorage` under `qk-spin-${id}`. When `Date.now()`
 *   is still inside the cooldown window the button is disabled and shows
 *   a countdown. The countdown re-renders once per second via setInterval.
 *
 * **Reduced motion:**
 *   `prefers-reduced-motion` users get an instant result — no rotation
 *   animation, `onSpin` fires synchronously. The reduced-motion media
 *   query is read once at mount and cached on a ref (we don't bother
 *   subscribing to changes — re-render-on-toggle would be overkill).
 *
 * **Accessibility:**
 *   - The spin button has an `aria-label`.
 *   - The winning reward is announced via a `role="status"` live region.
 *   - Keyboard: Enter or Space on the spin button triggers a spin (this
 *     is the native button behaviour — no extra handler required).
 */
import {
  type ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

// The exports below are intentionally not all React components; the
// helpers (`pickWeightedIndex`, `sliceArcPath`) are utility functions
// exposed for the test suite (deterministic slice geometry, weighted
// random picker). The component itself is the default export.

const SR_ONLY: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  borderWidth: 0,
};

/** One slice on the wheel. */
export interface SpinWheelSlice {
  /** The reward awarded if this slice wins. */
  reward: Reward;
  /** Optional weight for the weighted draw. Defaults to 1. Must be > 0. */
  weight?: number;
  /** Short human-readable label rendered inside the slice. */
  label: string;
  /** Slice fill color (any valid CSS color). Defaults to a palette pick. */
  color?: string;
}

export interface SpinWheelProps {
  /** Slices of the wheel, in display order around the circle (clockwise from top). */
  rewards: SpinWheelSlice[];
  /** Cooldown in ms between spins. Persisted in localStorage by `id`. */
  cooldownMs: number;
  /** Stable storage id, e.g. "daily-spin". */
  id: string;
  /** Called when the wheel settles on a reward (after animation). */
  onSpin: (reward: Reward) => void | Promise<void>;
  /** Diameter in CSS pixels. Default 280. */
  size?: number;
}

/**
 * Default slice palette used when a slice omits its `color`. Hand-picked
 * to alternate enough hues that adjacent slices contrast visually.
 */
const DEFAULT_PALETTE: readonly string[] = [
  "oklch(0.78 0.16 78)", // amber (matches --color-qk-coin)
  "oklch(0.62 0.18 264)", // indigo (matches --color-qk-primary)
  "oklch(0.72 0.18 150)", // green
  "oklch(0.70 0.20 25)", // red-orange
  "oklch(0.65 0.18 320)", // magenta
  "oklch(0.75 0.15 200)", // teal
  "oklch(0.68 0.17 50)", // orange
  "oklch(0.60 0.18 290)", // violet
];

/**
 * Picks a winning index using a cumulative-weight scan against a single
 * cryptographically-random uint32. Exported for tests that mock `crypto`.
 *
 * @internal
 */
export function pickWeightedIndex(weights: readonly number[]): number {
  const total = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (total <= 0) return 0;

  const buf = new Uint32Array(1);
  // jsdom provides `crypto.getRandomValues`; in non-DOM environments we
  // fall back to Math.random (acceptable since this branch is unreachable
  // in the supported runtimes).
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(buf);
  } else {
    // istanbul ignore next — defensive only.
    buf[0] = Math.floor(Math.random() * 0xFF_FF_FF_FF);
  }
  const rng = (buf[0] ?? 0) / 0x1_00_00_00_00; // [0, 1)
  const target = rng * total;

  let cum = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] ?? 0;
    cum += w > 0 ? w : 0;
    if (target < cum) return i;
  }
  return weights.length - 1;
}

/**
 * Build the SVG `d` attribute for a pie slice between two angles.
 * Angles are in radians; angle 0 = 3 o'clock (positive x-axis); angles
 * grow clockwise (SVG y-axis points down).
 *
 * @internal
 */
export function sliceArcPath(
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  endRad: number,
): string {
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endRad - startRad > Math.PI ? 1 : 0;
  return `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`;
}

/**
 * Number of full extra revolutions before the wheel lands. Larger = more
 * dramatic, but also longer animation. 5 felt right against a 4 s easing.
 */
const SPINS_EXTRA = 5;

/** Animation duration in ms — must match the CSS `transition-duration`. */
const ANIMATION_MS = 4000;

function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function readLastSpin(id: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(`qk-spin-${id}`);
    return raw === null ? 0 : Number(raw) || 0;
  } catch {
    return 0;
  }
}

function writeLastSpin(id: string, ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`qk-spin-${id}`, String(ts));
  } catch {
    /* localStorage may be disabled — ignore. */
  }
}

export function SpinWheel({
  rewards,
  cooldownMs,
  id,
  onSpin,
  size = 280,
}: SpinWheelProps): ReactElement {
  const reactId = useId();
  const labelId = `qk-spinwheel-label-${reactId}`;
  const statusId = `qk-spinwheel-status-${reactId}`;

  /** Cumulative rotation in degrees (always grows; we never modulo it
   *  because the CSS transition relies on the delta between renders). */
  const [rotationDeg, setRotationDeg] = useState<number>(0);
  const [spinning, setSpinning] = useState<boolean>(false);
  const [announcement, setAnnouncement] = useState<string>("");
  /** Last spin timestamp, kept in state so the countdown re-renders. */
  const [lastSpin, setLastSpin] = useState<number>(() => readLastSpin(id));
  /** "tick" forces a 1Hz re-render so the countdown text updates. */
  const [, setTick] = useState<number>(0);

  // Re-render every second while a cooldown is active. The interval is
  // torn down when the cooldown lapses to avoid a perpetual heartbeat.
  useEffect(() => {
    const remaining = lastSpin + cooldownMs - Date.now();
    if (remaining <= 0) return undefined;
    const handle = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(handle);
  }, [lastSpin, cooldownMs]);

  const reducedMotion = useRef<boolean>(false);
  useEffect(() => {
    reducedMotion.current = readReducedMotion();
  }, []);

  const wheelRef = useRef<SVGGElement | null>(null);

  /**
   * The reward + label captured at the moment the user clicks Spin, kept
   * here so the `transitionend` handler — which runs ~4 s later — can
   * complete the cycle without re-running the random draw. Cleared on
   * settle so a stray late `transitionend` (e.g. window resize) doesn't
   * re-fire `onSpin`.
   */
  const pendingRef = useRef<{ reward: Reward; label: string } | null>(null);

  const sliceCount = rewards.length;
  // Defensive: a zero-slice wheel renders nothing meaningful — we still
  // want to return a valid element rather than throw.
  const sliceAngleDeg = sliceCount > 0 ? 360 / sliceCount : 0;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4; // 4px breathing room for the stroke

  const remainingMs = Math.max(0, lastSpin + cooldownMs - Date.now());
  const inCooldown = remainingMs > 0;
  const disabled = spinning || inCooldown || sliceCount === 0;

  /**
   * Finalise a spin: stamp localStorage, flip flags, announce, and call
   * the host's `onSpin`. Idempotent — guarded by clearing `pendingRef`.
   * Declared before `handleSpin` because the reduced-motion branch of
   * `handleSpin` calls it synchronously.
   */
  const settle = useCallback((): void => {
    const pending = pendingRef.current;
    if (pending === null) return;
    pendingRef.current = null;
    const now = Date.now();
    setLastSpin(now);
    writeLastSpin(id, now);
    setSpinning(false);
    setAnnouncement(`You won: ${pending.label}`);
    void onSpin(pending.reward);
  }, [id, onSpin]);

  const handleSpin = useCallback((): void => {
    if (disabled) return;
    const weights = rewards.map((s) =>
      s.weight && s.weight > 0 ? s.weight : 1,
    );
    const winnerIdx = pickWeightedIndex(weights);
    const winner = rewards[winnerIdx];
    if (winner === undefined) return;

    // Where the *current* rotation puts winner's centre:
    //   sliceCentreAngle = winnerIdx * sliceAngle + sliceAngle/2
    // The pointer points to the top (angle -90° in our SVG, i.e. the
    // line from centre to (cx, 0)). We want the winning slice's centre
    // to land at -90°. With the wheel rotated by R degrees clockwise,
    // a slice originally drawn at angle A appears at angle A + R.
    // Solve A + R ≡ -90 (mod 360) → R ≡ -90 - A.
    const winnerCentre = winnerIdx * sliceAngleDeg + sliceAngleDeg / 2;
    // Aim for the smallest non-negative angle that *also* adds
    // SPINS_EXTRA full rotations and exceeds the current rotation.
    // We compute the *delta* on top of the existing rotation so the
    // CSS animation goes forward, not backward.
    const targetMod = (((-90 - winnerCentre) % 360) + 360) % 360;
    // Current rotation modulo 360 — to figure out how much more we need
    // to add before SPINS_EXTRA kicks in.
    const currentMod = ((rotationDeg % 360) + 360) % 360;
    const forwardDelta = (targetMod - currentMod + 360) % 360;
    const targetRotation = rotationDeg + 360 * SPINS_EXTRA + forwardDelta;

    setSpinning(true);
    setAnnouncement(""); // clear stale announcement
    pendingRef.current = { reward: winner.reward, label: winner.label };

    if (reducedMotion.current) {
      // Skip animation entirely. We still update the rotation to the
      // target so the visual matches reality, then settle synchronously.
      setRotationDeg(targetRotation);
      settle();
      return;
    }

    setRotationDeg(targetRotation);
    // The transitionend handler on the group is what fires onSpin.
  }, [disabled, rewards, rotationDeg, sliceAngleDeg, settle]);

  const handleTransitionEnd = useCallback(
    (e: React.TransitionEvent<SVGGElement>): void => {
      if (e.propertyName !== "transform") return;
      settle();
    },
    [settle],
  );

  // Re-read localStorage if `id` changes (rare, but supports demo toggling).
  useEffect(() => {
    setLastSpin(readLastSpin(id));
  }, [id]);

  const formatRemaining = (ms: number): string => {
    const totalSec = Math.ceil(ms / 1000);
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m < 60) return s === 0 ? `${m}m` : `${m}m ${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm === 0 ? `${h}h` : `${h}h ${mm}m`;
  };

  const buttonText = inCooldown
    ? `Next spin in ${formatRemaining(remainingMs)}`
    : spinning
      ? "Spinning…"
      : "Spin";

  return (
    <div
      className="qk-spinwheel"
      style={{
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        fontFamily: "var(--font-qk, system-ui)",
      }}
    >
      <span id={labelId} className="qk-sr-only" style={SR_ONLY}>
        Reward wheel with {sliceCount} prizes
      </span>
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
        }}
      >
        {/* Pointer triangle at the top, pointing down into the wheel. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -2,
            left: "50%",
            transform: "translateX(-50%)",
            width: 0,
            height: 0,
            borderLeft: "12px solid transparent",
            borderRight: "12px solid transparent",
            borderTop: "20px solid var(--color-qk-fg, #222)",
            zIndex: 2,
            filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.25))",
          }}
        />
        <svg
          role="img"
          aria-labelledby={labelId}
          viewBox={`0 0 ${size} ${size}`}
          width={size}
          height={size}
          style={{ display: "block" }}
        >
          <g
            ref={wheelRef}
            data-testid="qk-spinwheel-rotor"
            onTransitionEnd={handleTransitionEnd}
            style={{
              transform: `rotate(${rotationDeg}deg)`,
              transformOrigin: `${cx}px ${cy}px`,
              transition: reducedMotion.current
                ? "none"
                : `transform ${ANIMATION_MS}ms cubic-bezier(0.17, 0.67, 0.21, 1)`,
            }}
          >
            {rewards.map((slice, i) => {
              // SVG angle 0 is at 3 o'clock; we want slice 0 to start at
              // the top (-90° in degrees). We add a constant offset so
              // the first slice's leading edge is at the top of the
              // wheel.
              const startDeg = -90 + i * sliceAngleDeg;
              const endDeg = startDeg + sliceAngleDeg;
              const startRad = (startDeg * Math.PI) / 180;
              const endRad = (endDeg * Math.PI) / 180;
              const d = sliceArcPath(cx, cy, r, startRad, endRad);
              const midRad = (startRad + endRad) / 2;
              const labelR = r * 0.6;
              const lx = cx + labelR * Math.cos(midRad);
              const ly = cy + labelR * Math.sin(midRad);
              const labelRotation = (startDeg + endDeg) / 2 + 90; // upright-ish
              const color =
                slice.color ??
                DEFAULT_PALETTE[i % DEFAULT_PALETTE.length] ??
                "#888";
              return (
                <g key={`slice-${i}`} data-testid={`qk-spinwheel-slice-${i}`}>
                  <path
                    d={d}
                    fill={color}
                    stroke="rgba(255,255,255,0.6)"
                    strokeWidth={2}
                  />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${labelRotation} ${lx} ${ly})`}
                    fill="var(--color-qk-fg, #111)"
                    fontSize={Math.max(10, Math.round(size / 22))}
                    fontWeight={600}
                    pointerEvents="none"
                  >
                    {slice.label}
                  </text>
                </g>
              );
            })}
            {/* Subtle hub for visual polish. */}
            <circle
              cx={cx}
              cy={cy}
              r={Math.max(6, size * 0.04)}
              fill="var(--color-qk-bg, #fff)"
              stroke="var(--color-qk-fg, #222)"
              strokeWidth={1.5}
            />
          </g>
        </svg>
      </div>
      <button
        type="button"
        onClick={handleSpin}
        disabled={disabled}
        aria-label={
          inCooldown ? `Spin disabled — ${buttonText}` : "Spin the wheel"
        }
        aria-describedby={statusId}
        style={{
          appearance: "none",
          border: "none",
          padding: "0.5rem 1.25rem",
          minWidth: "10rem",
          borderRadius: "var(--radius-qk, 0.75rem)",
          background: disabled
            ? "var(--color-qk-muted, #c8c8d0)"
            : "var(--color-qk-primary, #4f46e5)",
          color: "white",
          fontWeight: 600,
          fontSize: "1rem",
          cursor: disabled ? "not-allowed" : "pointer",
          outlineOffset: 2,
        }}
        className="qk-spinwheel__button"
      >
        {buttonText}
      </button>
      <div id={statusId} role="status" aria-live="polite" style={SR_ONLY}>
        {announcement}
      </div>
    </div>
  );
}

export default SpinWheel;
