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
 *
 * Three toast variants (`DemoToastInput`):
 *   1. `Reward` — actual badge / currency / item grant. Warm gold chip
 *      with `BadgeIcon`/`CoinIcon`/`GiftIcon` glyph. Fired by
 *      `useMissionClaim` on a 200 OK claim.
 *   2. `DemoToastError` — non-success claim outcomes (F1 hotfix v0.1.9:
 *      the 409 `claim_not_ready` round-trip during a multi-session
 *      resume). Red-tinged chip with warning circle glyph.
 *   3. `DemoToastProgress` — per-spin / per-scratch progress nudge added
 *      in v0.1.15 (F7-a hotfix). The previous wiring fired a
 *      `{kind:"badge", badgeId:"lucky_spinner"}` toast on EVERY spin of
 *      the wheel and EVERY scratch reveal — DemoToastHost rendered that
 *      as "Badge: lucky_spinner" with the BadgeIcon, visually identical
 *      to the actual badge-grant toast that fires on successful claim.
 *      Users saw "Badge: …" after a single spin and concluded the badge
 *      had already been granted, when in fact no badge lands until the
 *      mission target is hit AND the user clicks Claim. The progress
 *      variant uses a neutral grey-blue chip with a distinct "+1" glyph
 *      and copy like "+1 toward Lucky Spinner badge" to make it obvious
 *      that the toast is a PROGRESS nudge, not a badge grant.
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

import { BadgeIcon, CoinIcon, GiftIcon } from "./icons";

/**
 * Error toast payload — surfaced for non-success claim outcomes that would
 * otherwise leave the user with no feedback (e.g. F1 hotfix v0.1.9: the
 * 409 `claim_not_ready` round-trip during a multi-session resume). The
 * discriminator overlaps the `Reward` union deliberately so callers pass
 * a single `kind`-tagged object and the host picks the visual variant.
 */
export interface DemoToastError {
  kind: "error";
  title: string;
  description?: string;
}

/**
 * Progress nudge payload — fired per spin/scratch BEFORE the mission is
 * actually completable (F7-a hotfix v0.1.15). `missionId` is the server
 * mission this nudge is advancing (used for diagnostics / future
 * filtering — not rendered directly). `label` is the human name of the
 * eventual reward (e.g. "Lucky Spinner badge") and is interpolated into
 * the user-facing copy ("+1 toward Lucky Spinner badge").
 *
 * Distinguish carefully from the `kind:"badge"` reward variant: that
 * fires on a successful CLAIM and means the badge has actually been
 * granted. This `progress` variant fires on every minigame interaction
 * BEFORE claim and just means the user has ticked one event toward the
 * mission's count.
 */
export interface DemoToastProgress {
  kind: "progress";
  missionId: string;
  label: string;
}

export type DemoToastInput = Reward | DemoToastError | DemoToastProgress;

interface ToastItem {
  id: number;
  input: DemoToastInput;
}

interface DemoToastContextValue {
  show: (input: DemoToastInput) => void;
}

const DemoToastContext = createContext<DemoToastContextValue | null>(null);

function isErrorToast(input: DemoToastInput): input is DemoToastError {
  return input.kind === "error";
}

function isProgressToast(input: DemoToastInput): input is DemoToastProgress {
  return input.kind === "progress";
}

function toastLabel(input: DemoToastInput): string {
  if (isErrorToast(input)) return input.title;
  if (isProgressToast(input)) return `+1 toward ${input.label}`;
  if (input.kind === "currency") {
    return `+${input.amount} ${input.currency}`;
  }
  if (input.kind === "badge") {
    return `Badge: ${input.badgeId}`;
  }
  return `${input.quantity}× ${input.itemId}`;
}

function ToastIcon({ input }: { input: DemoToastInput }): ReactElement {
  // 24px to match the 9×9-tailwind (36px) container with a comfortable bezel.
  if (isErrorToast(input)) {
    // Inline warning glyph — keeps the host self-contained (no new icon
    // module import). Stroke uses currentColor so the error variant's
    // surface colour (set below) drives it.
    return (
      <svg
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (isProgressToast(input)) {
    // "Plus inside circle" glyph — deliberately NOT the BadgeIcon so the
    // user can't confuse a progress nudge with the celebratory badge
    // grant. Stroke uses currentColor so the grey-blue progress surface
    // (set below) drives it.
    return (
      <svg
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
    );
  }
  if (input.kind === "currency") return <CoinIcon size={24} />;
  if (input.kind === "badge") return <BadgeIcon size={24} />;
  return <GiftIcon size={24} />;
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
    (input: DemoToastInput): void => {
      const id = Date.now() + Math.random();
      const item: ToastItem = { id, input };
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
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                      style={
                        isErrorToast(item.input)
                          ? {
                              background: "oklch(0.95 0.03 30)",
                              border: "1px solid oklch(0.75 0.13 30)",
                              color: "oklch(0.50 0.18 30)",
                            }
                          : isProgressToast(item.input)
                            ? {
                                // Neutral grey-blue chip — deliberately
                                // distinct from the warm-gold reward chip
                                // so the user reads this as "in progress"
                                // not "completed". Tone matches the
                                // existing demo-muted colour family.
                                background: "oklch(0.95 0.02 240)",
                                border: "1px solid oklch(0.80 0.05 240)",
                                color: "oklch(0.40 0.10 240)",
                              }
                            : {
                                background: "oklch(0.96 0.01 95)",
                                border: "1px solid oklch(0.85 0.04 90)",
                              }
                      }
                    >
                      <ToastIcon input={item.input} />
                    </span>
                    <span className="flex-1 text-sm font-semibold">
                      {toastLabel(item.input)}
                      {isErrorToast(item.input) &&
                      item.input.description !== undefined ? (
                        <span className="mt-0.5 block text-xs font-normal opacity-80">
                          {item.input.description}
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => dismiss(item.id)}
                      aria-label={
                        isErrorToast(item.input)
                          ? "Dismiss notice"
                          : isProgressToast(item.input)
                            ? "Dismiss progress notice"
                            : "Dismiss reward"
                      }
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
