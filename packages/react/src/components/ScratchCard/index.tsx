/**
 * <ScratchCard /> — a "scratch off the coating to reveal the prize"
 * mini-game powered by `<canvas>` and `globalCompositeOperation`.
 *
 * **How it works**
 *   - The `prize` element renders absolutely positioned underneath a
 *     `<canvas>` overlay.
 *   - On mount the canvas is painted opaque with `overlayColor` plus the
 *     centred `overlayLabel` text. As the user drags a finger or mouse,
 *     each `pointermove` paints a transparent disc via
 *     `globalCompositeOperation = 'destination-out'`, which subtracts
 *     pixels from the overlay and lets the prize show through.
 *   - A throttled-by-rAF sampler computes the *erased ratio* — the
 *     fraction of pixels whose alpha is below a threshold — and fires
 *     `onReveal` exactly once when the ratio crosses `threshold`.
 *
 * **Accessibility**
 *   - The canvas is focusable (`tabIndex={0}`) and labelled.
 *   - Pressing Space starts a 3-frame keyboard-only reveal animation
 *     (or instant reveal under `prefers-reduced-motion`).
 *   - The win is announced via a `role="status" aria-live="polite"` text
 *     region — same pattern as SpinWheel.
 *
 * **Performance & input quirks**
 *   - `touch-action: none` on the canvas so vertical drags don't get
 *     hijacked by page scrolling. The canvas itself listens for
 *     pointermove which already aggregates mouse/touch/pen events.
 *   - `getImageData` is comparatively expensive — we throttle the
 *     sampler to once per animation frame and stop sampling entirely
 *     after reveal.
 *   - The radius of the scratch brush is tuned to feel like a fingertip
 *     (20 CSS pixels), large enough to clear the threshold in a handful
 *     of strokes on a 280×160 card.
 */
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface ScratchCardProps {
  /** Element shown underneath the scratchable overlay (the "prize"). */
  prize: ReactNode;
  /** Called once when erased ratio first crosses `threshold`. */
  onReveal: () => void;
  /** Erased-pixel ratio that triggers reveal. Default 0.6 (60 %). */
  threshold?: number;
  /** Canvas width in CSS pixels. Default 280. */
  width?: number;
  /** Canvas height in CSS pixels. Default 160. */
  height?: number;
  /** Color of the overlay. Defaults to `--color-qk-muted`. */
  overlayColor?: string;
  /** Label text shown on the unscratched overlay. */
  overlayLabel?: string;
}

const BRUSH_RADIUS = 20;
const ALPHA_THRESHOLD = 64; // pixel is "erased" once its alpha drops below this

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

function readReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ScratchCard({
  prize,
  onReveal,
  threshold = 0.6,
  width = 280,
  height = 160,
  overlayColor,
  overlayLabel = "Scratch to reveal",
}: ScratchCardProps): ReactElement {
  const reactId = useId();
  const statusId = `qk-scratch-status-${reactId}`;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const scratchingRef = useRef<boolean>(false);
  /** rAF id for the throttled sampler; set when a sample is queued. */
  const sampleFrameRef = useRef<number | null>(null);
  /** Guard so `onReveal` fires exactly once. */
  const revealedRef = useRef<boolean>(false);
  const reducedMotionRef = useRef<boolean>(false);

  const [announcement, setAnnouncement] = useState<string>("");

  /**
   * Paint the initial opaque overlay. Pulled into a callback so the
   * keyboard fade animation can re-paint between frames if needed.
   */
  const paintOverlay = useCallback(
    (ctx: CanvasRenderingContext2D): void => {
      // We resolve `--color-qk-muted` lazily because the variable lives
      // on :root and may not be known at hook-mount time in tests; fall
      // back to a neutral grey when nothing is registered.
      const fill =
        overlayColor ??
        (typeof window !== "undefined"
          ? getComputedStyle(document.documentElement)
              .getPropertyValue("--color-qk-muted")
              .trim() || "#c8c8d0"
          : "#c8c8d0");
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, width, height);

      // Centred prompt text.
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.font = `600 ${Math.max(12, Math.round(height / 8))}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(overlayLabel, width / 2, height / 2);
    },
    [overlayColor, overlayLabel, width, height],
  );

  // Initial paint + reduced-motion read.
  useEffect(() => {
    reducedMotionRef.current = readReducedMotion();
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctxRef.current = ctx;
    paintOverlay(ctx);
  }, [paintOverlay]);

  // If width / height / label change later we re-paint, but only when
  // the user hasn't already revealed.
  useEffect(() => {
    const ctx = ctxRef.current;
    if (ctx === null || revealedRef.current) return;
    paintOverlay(ctx);
  }, [paintOverlay]);

  /**
   * Sample the canvas and compute the erased ratio. Cheap enough at
   * 280×160 (~45k pixels). Stops counting once the threshold is hit.
   */
  const sample = useCallback((): void => {
    sampleFrameRef.current = null;
    const ctx = ctxRef.current;
    if (ctx === null || revealedRef.current) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (w === 0 || h === 0) return;
    const data = ctx.getImageData(0, 0, w, h).data;
    let erased = 0;
    // Stride by 4 (RGBA). We only inspect alpha.
    for (let i = 3; i < data.length; i += 4) {
      const a = data[i];
      if (a !== undefined && a < ALPHA_THRESHOLD) erased += 1;
    }
    const total = data.length / 4;
    const ratio = total === 0 ? 0 : erased / total;
    if (ratio >= threshold) {
      revealedRef.current = true;
      setAnnouncement("Prize revealed");
      // Fully clear the overlay for a clean reveal.
      ctx.clearRect(0, 0, w, h);
      onReveal();
    }
  }, [threshold, onReveal]);

  const queueSample = useCallback((): void => {
    if (sampleFrameRef.current !== null) return;
    if (typeof requestAnimationFrame === "function") {
      sampleFrameRef.current = requestAnimationFrame(sample);
    } else {
      // istanbul ignore next — jsdom always provides rAF.
      sampleFrameRef.current = window.setTimeout(
        sample,
        16,
      ) as unknown as number;
    }
  }, [sample]);

  const eraseAt = useCallback(
    (x: number, y: number): void => {
      const ctx = ctxRef.current;
      if (ctx === null || revealedRef.current) return;
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, BRUSH_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      queueSample();
    },
    [queueSample],
  );

  const pointerPos = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ): { x: number; y: number } => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    // Map CSS coords to canvas internal coords — they match in our
    // setup but compute the scale anyway for correctness if a future
    // DPR-aware variant changes them.
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (revealedRef.current) return;
      // Reduced-motion fast path: a single click clears the whole card.
      if (reducedMotionRef.current) {
        const ctx = ctxRef.current;
        if (ctx === null) return;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (!revealedRef.current) {
          revealedRef.current = true;
          setAnnouncement("Prize revealed");
          onReveal();
        }
        return;
      }
      scratchingRef.current = true;
      // Capture so we keep receiving moves even if the pointer leaves.
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const { x, y } = pointerPos(e);
      eraseAt(x, y);
    },
    [eraseAt, onReveal],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (!scratchingRef.current || revealedRef.current) return;
      const { x, y } = pointerPos(e);
      eraseAt(x, y);
    },
    [eraseAt],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      scratchingRef.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    },
    [],
  );

  /**
   * Keyboard alternative — Space (or Enter) progressively erases the
   * overlay over 3 frames. Reduced motion: instant clear.
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>): void => {
      if (e.key !== " " && e.key !== "Enter" && e.key !== "Spacebar") return;
      e.preventDefault();
      if (revealedRef.current) return;
      const ctx = ctxRef.current;
      if (ctx === null) return;
      if (reducedMotionRef.current) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        revealedRef.current = true;
        setAnnouncement("Prize revealed");
        onReveal();
        return;
      }
      // 3-frame fade: each frame erases a third (row band) of the
      // canvas. We use simple destination-out fillRects rather than
      // arcs because keyboard users can't aim a brush.
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;
      const slice = Math.ceil(h / 3);
      let frame = 0;
      const step = (): void => {
        if (revealedRef.current) return;
        ctx.globalCompositeOperation = "destination-out";
        ctx.fillStyle = "rgba(0,0,0,1)";
        ctx.fillRect(0, frame * slice, w, slice);
        queueSample();
        frame += 1;
        if (frame < 3) {
          if (typeof requestAnimationFrame === "function") {
            requestAnimationFrame(step);
          } else {
            // istanbul ignore next
            setTimeout(step, 16);
          }
        }
      };
      step();
    },
    [onReveal, queueSample],
  );

  // Clean up the rAF on unmount.
  useEffect(() => {
    return () => {
      if (sampleFrameRef.current !== null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(sampleFrameRef.current);
        } else {
          // istanbul ignore next
          clearTimeout(sampleFrameRef.current);
        }
        sampleFrameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      className="qk-scratchcard"
      style={{
        position: "relative",
        display: "inline-block",
        width,
        height,
        borderRadius: "var(--radius-qk, 0.75rem)",
        overflow: "hidden",
        fontFamily: "var(--font-qk, system-ui)",
      }}
    >
      <div
        className="qk-scratchcard__prize"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {prize}
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        tabIndex={0}
        role="img"
        aria-label="Scratch card overlay"
        aria-describedby={statusId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        data-testid="qk-scratchcard-canvas"
        style={{
          position: "absolute",
          inset: 0,
          width,
          height,
          touchAction: "none",
          cursor: "grab",
          display: "block",
        }}
      />
      <div id={statusId} role="status" aria-live="polite" style={SR_ONLY}>
        {announcement}
      </div>
    </div>
  );
}

export default ScratchCard;
