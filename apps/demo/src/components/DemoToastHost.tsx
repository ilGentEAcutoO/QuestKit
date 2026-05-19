/**
 * DemoToastHost — animated reward toast surface for the demo app.
 *
 * Reuses the @questkit/react CSS token vocabulary but adds framer-motion
 * spring slide-in / slide-out via AnimatePresence. Honours
 * prefers-reduced-motion by zeroing the transitions.
 *
 * Why not the @questkit/react RewardClaimToastHost?
 * The host inside the package is a portable default — host apps theme
 * its surface but its animation is a plain CSS keyframe (so the package
 * doesn't ship framer-motion as a peer). The demo wants the spring
 * motion polish, so we render our own host here and expose `useDemoToast`
 * as the local imperative API. Callers in routes/* use the demo hook;
 * library widgets that use `useRewardClaimToast` directly would still
 * fall through the @questkit/react singleton but no demo route does so.
 */
import type { Reward } from "@questkit/types";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface ToastItem {
  id: number;
  reward: Reward;
}

interface DemoToastContextValue {
  show: (reward: Reward) => void;
}

const DemoToastContext = createContext<DemoToastContextValue | null>(null);

function rewardLabel(reward: Reward): string {
  if (reward.kind === "currency") {
    return `+${reward.amount} ${reward.currency}`;
  }
  if (reward.kind === "badge") {
    return `Badge: ${reward.badgeId}`;
  }
  return `${reward.quantity}× ${reward.itemId}`;
}

function rewardIcon(reward: Reward): string {
  if (reward.kind === "currency") return "🪙";
  if (reward.kind === "badge") return "🏆";
  return "🎁";
}

interface DemoToastProviderProps {
  children: ReactNode;
  durationMs?: number;
}

export function DemoToastProvider({
  children,
  durationMs = 4000,
}: DemoToastProviderProps): ReactElement {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState<boolean>(false);
  const reduced = useReducedMotion();

  useEffect(() => {
    setMounted(true);
  }, []);

  const dismiss = useCallback((id: number): void => {
    setItems((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const show = useCallback(
    (reward: Reward): void => {
      const id = Date.now() + Math.random();
      const item: ToastItem = { id, reward };
      setItems((prev) => [...prev, item]);
      setTimeout(() => {
        setItems((prev) => prev.filter((p) => p.id !== id));
      }, durationMs);
    },
    [durationMs],
  );

  const value = useMemo<DemoToastContextValue>(() => ({ show }), [show]);

  return (
    <DemoToastContext.Provider value={value}>
      {children}
      {mounted && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-live="polite"
              aria-atomic="false"
              className="pointer-events-none fixed inset-x-0 bottom-4 z-[9999] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end"
            >
              <AnimatePresence>
                {items.map((item) => (
                  <motion.div
                    key={item.id}
                    layout
                    role="status"
                    initial={
                      reduced
                        ? { opacity: 1, y: 0 }
                        : { opacity: 0, y: 80, scale: 0.95 }
                    }
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={
                      reduced
                        ? { opacity: 0 }
                        : { opacity: 0, y: 60, scale: 0.95 }
                    }
                    transition={
                      reduced
                        ? { duration: 0 }
                        : { type: "spring", stiffness: 300, damping: 30 }
                    }
                    className="pointer-events-auto flex w-full max-w-xs items-center gap-3 rounded-[var(--radius-card)] border px-4 py-3 shadow-2xl"
                    style={{
                      background: "var(--color-qk-bg)",
                      color: "var(--color-qk-fg)",
                      borderColor: "var(--color-demo-border)",
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg"
                      style={{
                        background: "var(--color-qk-coin)",
                        color: "var(--color-qk-fg)",
                      }}
                    >
                      {rewardIcon(item.reward)}
                    </span>
                    <span className="flex-1 text-sm font-semibold">
                      {rewardLabel(item.reward)}
                    </span>
                    <button
                      type="button"
                      onClick={() => dismiss(item.id)}
                      aria-label="Dismiss reward"
                      className="grid h-7 w-7 place-items-center rounded-md text-base transition-colors hover:bg-[color:var(--color-demo-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
                      style={{ color: "var(--color-qk-fg)" }}
                    >
                      <span aria-hidden="true">×</span>
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>,
            document.body,
          )
        : null}
    </DemoToastContext.Provider>
  );
}

export function useDemoToast(): DemoToastContextValue {
  const ctx = useContext(DemoToastContext);
  if (ctx === null) {
    throw new Error(
      "useDemoToast must be used inside <DemoToastProvider>. Mount the provider near the app root.",
    );
  }
  return ctx;
}
