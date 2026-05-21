/**
 * Daily streak scenario — single "Check In" CTA that fires daily.login.
 *
 * Source of truth: the server-side Daily Visitor mission (mis_daily_visitor,
 * migration 0003 — eventName="daily.login", count=1, window=daily). The
 * route reads from useMissions() so the streak hero always agrees with
 * the MissionCard below, including the post-claim "Already checked in"
 * state. Phase 9 / TASK-002 removed the localStorage mirror that used to
 * drift from server state and caused bug B4 — there's now ONE source.
 */
import { MissionCard, useEvent, useMissions } from "@questkit/react";

import { AnimatePresence, motion } from "framer-motion";
import { type ReactElement, useState } from "react";
import { SceneHeading } from "../components/SceneHeading";

import { useMissionClaim } from "../lib/useMissionClaim";

// Mission whose progress drives the streak hero. Pinned to the Daily
// Visitor mission added in migration 0003 — eventName="daily.login",
// count=1, window=daily. The currentCount semantics: 1 after today's
// check-in lands; reset to 0 by the rule engine at the next UTC midnight.
const DAILY_MISSION_ID = "mis_daily_visitor";

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function DailyRoute(): ReactElement {
  const { fireEvent, isFiring } = useEvent();
  const [justClicked, setJustClicked] = useState<boolean>(false);

  // Reuse useMissions to surface the daily-related missions further down
  // AND to derive the streak hero count. The Daily Visitor mission lives
  // in the e-commerce campaign per migration 0003 (the demo doesn't have a
  // dedicated daily campaign — see that migration's docstring).
  const missions = useMissions({ campaignId: "camp_ecom_2026q2" });

  // Wire the claim handler with a refetch fallback so the UI converges to
  // status="claimed" even if the SSE `mission.claimed` event drops — see
  // useMissionClaim's docstring (Phase 9 / TASK-001 Cluster C1).
  const handleClaim = useMissionClaim({ onClaimed: missions.refetch });

  // Derive both the hero count and claimedToday from server state. The
  // daily mission has count=1/window=daily — currentCount is NOT a
  // multi-day streak counter (the server doesn't track consecutive days
  // for v0.1), it's just "have you checked in within today's UTC window".
  //
  // claimedToday: gated on `updatedAt` falling in today's UTC window AND
  // currentCount > 0. Without the window gate, a returning user who
  // claimed yesterday would see "Already checked in today" on a fresh
  // visit today — exactly the localStorage-era bug we're fixing. The
  // rule engine resets the row on the first daily.login fired in a new
  // window (see workers/api/src/rules/evaluator.ts:99-125), so once
  // today's check-in lands, updatedAt + currentCount swing into today's
  // window.
  //
  // streakCount: 1 when claimedToday, 0 otherwise. We deliberately don't
  // try to surface a multi-day "consecutive streak" — the server schema
  // doesn't carry that yet. Math.min vs the target clamps defensively.
  const dailyProgress = missions.data?.progress[DAILY_MISSION_ID];
  const target = dailyProgress?.targetCount ?? 1;
  const today = startOfDay(Date.now());
  const claimedToday =
    dailyProgress !== undefined &&
    startOfDay(dailyProgress.updatedAt) === today &&
    dailyProgress.currentCount > 0;
  const streakCount = claimedToday
    ? Math.min(dailyProgress.currentCount, target)
    : 0;

  async function handleCheckIn(): Promise<void> {
    if (claimedToday) return;
    setJustClicked(true);
    try {
      await fireEvent({ name: "daily.login", payload: {} });
      // No local state to write — useMissions handles the optimistic
      // +1 bump on a successful fireEvent (TASK-006). The next SSE
      // delivery (or refetch) reconciles the exact server timestamp.
    } catch {
      // Event-log surfaces failures.
    } finally {
      // Reset the click flag after the celebration animation runs.
      setTimeout(() => setJustClicked(false), 1200);
    }
  }

  return (
    <div className="space-y-8">
      <SceneHeading
        emoji="📅"
        title="Daily streak"
        description="One tap per day fires daily.login. Keep the chain alive — the rule engine resets the daily window at UTC midnight."
      />

      <section
        aria-label="Streak status"
        className="relative overflow-hidden rounded-[var(--radius-card)] border p-6 sm:p-8"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in oklch, var(--color-qk-primary) 12%, var(--color-demo-surface-2)) 0%, var(--color-demo-surface-2) 100%)",
          borderColor: "var(--color-demo-border)",
        }}
      >
        <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p
              className="text-xs uppercase tracking-widest"
              style={{ color: "var(--color-demo-muted)" }}
            >
              Current streak
            </p>
            <p className="mt-1 flex items-baseline gap-2">
              <motion.span
                key={streakCount}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 240, damping: 20 }}
                className="text-5xl font-bold tabular-nums"
                style={{ color: "var(--color-qk-primary)" }}
              >
                {streakCount}
              </motion.span>
              <span
                className="text-base font-medium"
                style={{ color: "var(--color-demo-muted)" }}
              >
                day{streakCount === 1 ? "" : "s"}
              </span>
            </p>
            <p
              className="mt-2 text-sm"
              style={{ color: "var(--color-demo-muted)" }}
            >
              {claimedToday
                ? "Already checked in today — come back tomorrow."
                : "Check in to start (or extend) the chain."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleCheckIn();
            }}
            disabled={isFiring || claimedToday}
            aria-label={
              claimedToday ? "Already checked in today" : "Check in for today"
            }
            className="inline-flex min-w-[10rem] items-center justify-center gap-2 rounded-[var(--radius-pill)] px-5 py-3 text-base font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
            style={{ background: "var(--color-qk-primary)" }}
          >
            {isFiring ? "Saving…" : claimedToday ? "Checked in" : "Check in"}
          </button>
        </div>
        <AnimatePresence>
          {justClicked && (
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="pointer-events-none absolute right-4 top-4 text-4xl"
              aria-hidden="true"
            >
              ✨
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <section aria-labelledby="daily-missions" className="space-y-3">
        <h3
          id="daily-missions"
          className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-demo-muted)]"
        >
          Today's missions
        </h3>
        {missions.isLoading ? (
          <p
            role="status"
            className="text-sm"
            style={{ color: "var(--color-demo-muted)" }}
          >
            Loading missions…
          </p>
        ) : missions.data && missions.data.missions.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {missions.data.missions
              .filter((m) => m.criteria.window === "daily")
              .map((mission) => (
                <li key={mission.id}>
                  <MissionCard
                    mission={mission}
                    progress={missions.data?.progress[mission.id] ?? undefined}
                    onClaim={handleClaim}
                  />
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: "var(--color-demo-muted)" }}>
            No daily missions are active right now.
          </p>
        )}
      </section>
    </div>
  );
}
