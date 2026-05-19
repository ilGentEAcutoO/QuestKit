/**
 * ScratchCard — RTL specs.
 *
 * jsdom's canvas is a no-op stub: `getContext('2d')` returns null. To
 * exercise the real code path we patch `HTMLCanvasElement.prototype.getContext`
 * with a mock 2d context that records calls and returns a controllable
 * `getImageData` payload. Pointer events are dispatched with explicit
 * client coordinates; the component maps them to canvas coords via the
 * standard `getBoundingClientRect` plumbing.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

import { ScratchCard } from "../../src/components/ScratchCard";

/** A controllable fake 2d context. Only the methods the component uses. */
interface FakeCtx {
  globalCompositeOperation: string;
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  canvas: HTMLCanvasElement;
  fillRect: jest.Mock;
  clearRect: jest.Mock;
  beginPath: jest.Mock;
  arc: jest.Mock;
  fill: jest.Mock;
  fillText: jest.Mock;
  getImageData: jest.Mock;
}

function installFakeCanvas(opts: { erasedRatio: number }): {
  ctx: FakeCtx;
  restore: () => void;
} {
  const original = HTMLCanvasElement.prototype.getContext;
  // The component reads canvas.width and canvas.height — those work in
  // jsdom natively (they reflect the attribute).
  const ctx: FakeCtx = {
    globalCompositeOperation: "source-over",
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    canvas: null as unknown as HTMLCanvasElement,
    fillRect: jest.fn(),
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillText: jest.fn(),
    getImageData: jest.fn().mockImplementation((_x, _y, w, h) => {
      const total = w * h;
      const erased = Math.floor(total * opts.erasedRatio);
      // 4 bytes per pixel. Alpha at index 3.
      const data = new Uint8ClampedArray(total * 4);
      for (let i = 0; i < total; i++) {
        // First `erased` pixels are fully transparent (alpha 0 < threshold).
        // Remaining pixels are opaque (alpha 255).
        data[i * 4 + 3] = i < erased ? 0 : 255;
      }
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    }),
  };

  HTMLCanvasElement.prototype.getContext = function (
    this: HTMLCanvasElement,
  ): RenderingContext | null {
    ctx.canvas = this;
    return ctx as unknown as RenderingContext;
  } as typeof HTMLCanvasElement.prototype.getContext;

  return {
    ctx,
    restore: () => {
      HTMLCanvasElement.prototype.getContext = original;
    },
  };
}

/**
 * Patch rAF so each scheduled callback fires synchronously *after* the
 * production code has stored the rAF id on its ref. We do that by
 * calling the callback via a queueMicrotask trampoline — the outer
 * `sampleFrameRef.current = requestAnimationFrame(sample)` assignment
 * has landed by the time the callback runs, so the callback's own
 * `sampleFrameRef.current = null` reset wins.
 *
 * Returns a `flush()` function that drains all queued callbacks; tests
 * wrap their interactions in `act()` and then call `flush()` to settle.
 */
function installSyncRaf(): { restore: () => void; flush: () => void } {
  const rafOriginal = globalThis.requestAnimationFrame;
  const cafOriginal = globalThis.cancelAnimationFrame;
  let nextId = 1;
  const queue = new Map<number, FrameRequestCallback>();
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    queue.delete(id);
  }) as typeof cancelAnimationFrame;
  const flush = (): void => {
    // Drain repeatedly because a callback may queue another.
    while (queue.size > 0) {
      const entries = [...queue.entries()];
      queue.clear();
      for (const [, cb] of entries) cb(performance.now());
    }
  };
  return {
    restore: () => {
      globalThis.requestAnimationFrame = rafOriginal;
      globalThis.cancelAnimationFrame = cafOriginal;
    },
    flush,
  };
}

/** Patch getBoundingClientRect on a specific canvas so coord math is deterministic. */
function stubRect(canvas: HTMLCanvasElement, rect: DOMRect): () => void {
  const original = canvas.getBoundingClientRect;
  canvas.getBoundingClientRect = () => rect;
  return () => {
    canvas.getBoundingClientRect = original;
  };
}

describe("scratchCard — rendering", () => {
  it("mounts a canvas with the requested dimensions and prize underneath", () => {
    const fake = installFakeCanvas({ erasedRatio: 0 });
    try {
      render(
        <ScratchCard
          prize={<span data-testid="prize-text">You won!</span>}
          onReveal={() => {}}
          width={300}
          height={180}
        />,
      );
      const canvas = screen.getByTestId("qk-scratchcard-canvas");
      expect(canvas.tagName).toBe("CANVAS");
      expect((canvas as HTMLCanvasElement).width).toBe(300);
      expect((canvas as HTMLCanvasElement).height).toBe(180);
      expect(screen.getByTestId("prize-text")).toBeInTheDocument();
      // Initial overlay paint happened.
      expect(fake.ctx.fillRect).toHaveBeenCalled();
      expect(fake.ctx.fillText).toHaveBeenCalled();
    } finally {
      fake.restore();
    }
  });
});

describe("scratchCard — pointer interaction", () => {
  it("fires onReveal exactly once when erased ratio crosses threshold", () => {
    // First sample returns 30% (below 60%), second returns 80% (above).
    let callIdx = 0;
    const fake = installFakeCanvas({ erasedRatio: 0 });
    fake.ctx.getImageData = jest.fn().mockImplementation((_x, _y, w, h) => {
      const total = w * h;
      const ratio = callIdx === 0 ? 0.3 : 0.8;
      callIdx += 1;
      const erased = Math.floor(total * ratio);
      const data = new Uint8ClampedArray(total * 4);
      for (let i = 0; i < total; i++) {
        data[i * 4 + 3] = i < erased ? 0 : 255;
      }
      return { data, width: w, height: h, colorSpace: "srgb" } as ImageData;
    });
    const raf = installSyncRaf();
    const onReveal = jest.fn();
    try {
      render(
        <ScratchCard
          prize={<span>Prize</span>}
          onReveal={onReveal}
          width={40}
          height={20}
        />,
      );
      const canvas = screen.getByTestId(
        "qk-scratchcard-canvas",
      ) as HTMLCanvasElement;
      const restoreRect = stubRect(canvas, {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 40,
        bottom: 20,
        width: 40,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect);

      // First stroke — 30% erased, no reveal yet.
      act(() => {
        fireEvent.pointerDown(canvas, {
          clientX: 10,
          clientY: 10,
          pointerId: 1,
        });
        raf.flush();
      });
      expect(onReveal).not.toHaveBeenCalled();

      // Second stroke — 80% erased, reveal triggers.
      act(() => {
        fireEvent.pointerMove(canvas, {
          clientX: 20,
          clientY: 10,
          pointerId: 1,
        });
        raf.flush();
      });
      expect(onReveal).toHaveBeenCalledTimes(1);
      expect(fake.ctx.clearRect).toHaveBeenCalled();

      // Further moves do nothing.
      act(() => {
        fireEvent.pointerMove(canvas, {
          clientX: 30,
          clientY: 10,
          pointerId: 1,
        });
        raf.flush();
      });
      expect(onReveal).toHaveBeenCalledTimes(1);

      restoreRect();
    } finally {
      fake.restore();
      raf.restore();
    }
  });

  it("ignores pointermove that occurs without a prior pointerdown", () => {
    const fake = installFakeCanvas({ erasedRatio: 0.8 });
    const raf = installSyncRaf();
    const onReveal = jest.fn();
    try {
      render(
        <ScratchCard
          prize={<span>Prize</span>}
          onReveal={onReveal}
          width={40}
          height={20}
        />,
      );
      const canvas = screen.getByTestId(
        "qk-scratchcard-canvas",
      ) as HTMLCanvasElement;
      const restoreRect = stubRect(canvas, {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 40,
        bottom: 20,
        width: 40,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect);

      act(() => {
        fireEvent.pointerMove(canvas, {
          clientX: 10,
          clientY: 10,
          pointerId: 1,
        });
        raf.flush();
      });
      expect(onReveal).not.toHaveBeenCalled();
      restoreRect();
    } finally {
      fake.restore();
      raf.restore();
    }
  });
});

describe("scratchCard — keyboard alternative", () => {
  it("space key triggers progressive reveal which fires onReveal when sampler trips", () => {
    const fake = installFakeCanvas({ erasedRatio: 0.8 });
    const raf = installSyncRaf();
    const onReveal = jest.fn();
    try {
      render(
        <ScratchCard
          prize={<span>Prize</span>}
          onReveal={onReveal}
          width={40}
          height={30}
        />,
      );
      const canvas = screen.getByTestId(
        "qk-scratchcard-canvas",
      ) as HTMLCanvasElement;
      act(() => {
        fireEvent.keyDown(canvas, { key: " " });
        raf.flush();
      });
      expect(onReveal).toHaveBeenCalledTimes(1);
      // The progressive fade is implemented via destination-out fillRect.
      expect(fake.ctx.fillRect).toHaveBeenCalled();
    } finally {
      fake.restore();
      raf.restore();
    }
  });

  it("ignores non-Space keys", () => {
    const fake = installFakeCanvas({ erasedRatio: 0.8 });
    const raf = installSyncRaf();
    const onReveal = jest.fn();
    try {
      render(<ScratchCard prize={<span>Prize</span>} onReveal={onReveal} />);
      const canvas = screen.getByTestId(
        "qk-scratchcard-canvas",
      ) as HTMLCanvasElement;
      act(() => {
        fireEvent.keyDown(canvas, { key: "a" });
        raf.flush();
      });
      expect(onReveal).not.toHaveBeenCalled();
    } finally {
      fake.restore();
      raf.restore();
    }
  });
});

describe("scratchCard — reduced motion", () => {
  it("clicking immediately clears the canvas and fires onReveal when prefers-reduced-motion is set", () => {
    const fake = installFakeCanvas({ erasedRatio: 0 });
    const onReveal = jest.fn();
    const originalMM = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      media: q,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      render(
        <ScratchCard
          prize={<span>Prize</span>}
          onReveal={onReveal}
          width={40}
          height={20}
        />,
      );
      const canvas = screen.getByTestId(
        "qk-scratchcard-canvas",
      ) as HTMLCanvasElement;
      const restoreRect = stubRect(canvas, {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 40,
        bottom: 20,
        width: 40,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect);
      act(() => {
        fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 });
      });
      expect(onReveal).toHaveBeenCalledTimes(1);
      expect(fake.ctx.clearRect).toHaveBeenCalled();
      restoreRect();
    } finally {
      fake.restore();
      window.matchMedia = originalMM;
    }
  });

  it("space key with reduced-motion clears immediately and fires onReveal", () => {
    const fake = installFakeCanvas({ erasedRatio: 0 });
    const onReveal = jest.fn();
    const originalMM = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      media: q,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })) as unknown as typeof window.matchMedia;
    try {
      render(<ScratchCard prize={<span>Prize</span>} onReveal={onReveal} />);
      const canvas = screen.getByTestId(
        "qk-scratchcard-canvas",
      ) as HTMLCanvasElement;
      act(() => {
        fireEvent.keyDown(canvas, { key: " " });
      });
      expect(onReveal).toHaveBeenCalledTimes(1);
      expect(fake.ctx.clearRect).toHaveBeenCalled();
    } finally {
      fake.restore();
      window.matchMedia = originalMM;
    }
  });
});
