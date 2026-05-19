/**
 * <RewardClaimToast /> — portal-based reward announcement toast.
 *
 * Three pieces:
 *
 *   1. An internal `toastEmitter` singleton (module-scoped, no module-side
 *      DOM access — SSR safe) that any component can `show()` against.
 *   2. `<RewardClaimToastHost>` — the renderer. Subscribes to the emitter,
 *      portals a toast element into `document.body`, and auto-dismisses
 *      each toast after 4 s. Respects `prefers-reduced-motion` by skipping
 *      the slide animation.
 *   3. `useRewardClaimToast()` — the consumer-facing imperative API. Returns
 *      `{ show: (reward: Reward) => void }`.
 *
 * Why an emitter instead of context? Because hosts can mount in any branch
 * of the tree (or none — the toast renders to `document.body`), and the
 * consumer might call `show()` from a hook that lives outside the host's
 * sub-tree. A module singleton sidesteps the "wrap your app in a provider"
 * dance for what is essentially a global UX side channel.
 *
 * Accessibility:
 *   - The host renders an `aria-live="polite"` region so the reward is
 *     announced without interrupting screen-reader speech.
 *   - The dismiss button (when shown) is keyboard-reachable, has a visible
 *     focus ring, and an `aria-label`.
 */
import type { Reward } from "@questkit/types";
import type { ReactElement } from "react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface ToastItem {
  id: number;
  reward: Reward;
}

type Listener = (item: ToastItem) => void;

class ToastEmitter {
  private readonly listeners = new Set<Listener>();
  private nextId = 1;

  show(reward: Reward): void {
    const item: ToastItem = { id: this.nextId++, reward };
    for (const listener of this.listeners) {
      listener(item);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }
}

// Module-scoped singleton. Safe for SSR because there are no side effects
// here — the emitter does not touch `document` / `window` until subscribed.
const toastEmitter = new ToastEmitter();

// Module-scoped registry to clear pending dismiss timers on host unmount.
// Declared up-here so the RewardClaimToastHost component below can reference
// it without `no-use-before-define` complaints.
const timerRegistry = new Set<ReturnType<typeof setTimeout>>();

export interface UseRewardClaimToastResult {
  show: (reward: Reward) => void;
}

/**
 * Imperative API to trigger a reward toast. Use this from any descendant of
 * the host (or from anywhere — the emitter is module-scoped).
 *
 *   const { show } = useRewardClaimToast();
 *   show({ kind: "currency", currency: "GOLD", amount: 10 });
 */
export function useRewardClaimToast(): UseRewardClaimToastResult {
  return {
    show: (reward: Reward): void => {
      toastEmitter.show(reward);
    },
  };
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

function rewardLabel(reward: Reward): string {
  if (reward.kind === "currency") {
    return `+${reward.amount} ${reward.currency}`;
  }
  if (reward.kind === "badge") {
    return `Badge: ${reward.badgeId}`;
  }
  return `${reward.quantity}× ${reward.itemId}`;
}

interface ToastViewProps {
  item: ToastItem;
  reducedMotion: boolean;
  onDismiss: (id: number) => void;
}

function ToastView({
  item,
  reducedMotion,
  onDismiss,
}: ToastViewProps): ReactElement {
  return (
    <div
      className="qk-toast"
      role="status"
      style={{
        background: "var(--color-qk-bg)",
        color: "var(--color-qk-fg)",
        borderRadius: "var(--radius-qk)",
        fontFamily: "var(--font-qk)",
        padding: "0.75rem 1rem",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        minWidth: "12rem",
        marginTop: "0.5rem",
        animation: reducedMotion
          ? undefined
          : "qk-toast-in 200ms ease-out both",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          background: "var(--color-qk-coin)",
          color: "var(--color-qk-fg)",
          borderRadius: "var(--radius-qk)",
          padding: "0.25rem 0.5rem",
          fontWeight: 600,
        }}
      >
        +
      </span>
      <span className="qk-toast-label" style={{ flex: 1 }}>
        {rewardLabel(item.reward)}
      </span>
      <button
        type="button"
        aria-label="Dismiss reward"
        onClick={(): void => onDismiss(item.id)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--color-qk-fg)",
          cursor: "pointer",
          fontSize: "1rem",
          padding: "0.25rem 0.5rem",
          borderRadius: "var(--radius-qk)",
        }}
      >
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

export interface RewardClaimToastHostProps {
  /** Dismiss duration in ms. Default: 4000. */
  durationMs?: number;
}

/**
 * Mount this exactly once near the root of your app. It portals all reward
 * toasts into `document.body` so they layer above your normal tree.
 */
export function RewardClaimToastHost({
  durationMs = 4000,
}: RewardClaimToastHostProps = {}): ReactElement | null {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState<boolean>(false);

  // SSR guard: the portal target is `document.body`, which doesn't exist
  // during server render. We delay the first render until the client mount
  // tick so we don't blow up under Next.js / Remix server passes.
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const unsub = toastEmitter.subscribe((item: ToastItem) => {
      setItems((prev) => [...prev, item]);
      // Auto-dismiss after `durationMs`. We don't try to coalesce timers
      // across items — each one owns its own setTimeout. If the host
      // unmounts in the meantime, the cleanup below clears all of them.
      const t = setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== item.id));
      }, durationMs);
      // Track the timer so the cleanup can clear it. We attach it to the
      // item id via a side map, but for simplicity we just store the
      // timer reference on the item itself (cast back when clearing).
      // The Set below is the canonical timer registry.
      timerRegistry.add(t);
    });
    return (): void => {
      unsub();
      for (const t of timerRegistry) {
        clearTimeout(t);
      }
      timerRegistry.clear();
    };
    // durationMs change resets the subscription so existing items honour
    // the new dismiss window on subsequent shows. (Already-displayed
    // toasts keep their original timer.)
  }, [durationMs]);

  const handleDismiss = (id: number): void => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  };

  if (!mounted) return null;
  if (typeof document === "undefined") return null;

  const reduced = prefersReducedMotion();

  return createPortal(
    <div
      className="qk-toast-host"
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: "fixed",
        top: "1rem",
        right: "1rem",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        pointerEvents: "auto",
      }}
    >
      <style>{`
        @keyframes qk-toast-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {items.map((item) => (
        <ToastView
          key={item.id}
          item={item}
          reducedMotion={reduced}
          onDismiss={handleDismiss}
        />
      ))}
    </div>,
    document.body,
  );
}

// Re-exposed only for tests; do NOT depend on this from app code.
export const __testOnly = { toastEmitter };
