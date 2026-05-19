/**
 * Daily streak scenario — single "Check In" CTA that fires daily.login.
 *
 * The mission rule engine maintains the streak server-side (the daily
 * window resets at UTC midnight). For demo UX we mirror it locally so
 * the counter pops the moment a click lands — the source of truth still
 * comes from useMissions on next refetch.
 */
import { MissionCard, useEvent, useMissions } from "@questkit/react";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactElement, useState } from "react";

import { SceneHeading } from "../components/SceneHeading";

const STREAK_STORAGE_KEY = "qk-demo-daily-streak";

interface StreakState {
  count: number;
  lastTimestamp: number | null;
}

function readStreak(): StreakState {
  if (typeof window === "undefined") return { count: 0, lastTimestamp: null };
  try {
    const raw = window.localStorage.getItem(STREAK_STORAGE_KEY);
    if (raw === null) return { count: 0, lastTimestamp: null };
    const parsed = JSON.parse(raw) as Partial<StreakState>;
    if (typeof parsed.count !== "number" || parsed.count < 0) {
      return { count: 0, lastTimestamp: null };
    }
    return {
      count: parsed.count,
      lastTimestamp:
        typeof parsed.lastTimestamp === "number" ? parsed.lastTimestamp : null,
    };
  } catch {
    return { count: 0, lastTimestamp: null };
  }
}

function writeStreak(state: StreakState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STREAK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (private mode, quota) — silently degrade.
  }
}

function startOfDay(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function DailyRoute(): ReactElement {
  const { fireEvent, isFiring } = useEvent();
  const [streak, setStreak] = useState<StreakState>(() => readStreak());
  const [justClicked, setJustClicked] = useState<boolean>(false);

  // Reuse useMissions to surface the daily-related missions further down.
  const missions = useMissions({ campaignId: "camp_ecom_2026q2" });

  const today = startOfDay(Date.now());
  const claimedToday =
    streak.lastTimestamp !== null && startOfDay(streak.lastTimestamp) === today;

  async function handleCheckIn(): Promise<void> {
    if (claimedToday) return;
    setJustClicked(true);
    try {
      await fireEvent({ name: "daily.login", payload: {} });
      const next: StreakState = {
        count: streak.count + 1,
        lastTimestamp: Date.now(),
      };
      setStreak(next);
      writeStreak(next);
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
                key={streak.count}
                initial={{ scale: 0.7, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 240, damping: 20 }}
                className="text-5xl font-bold tabular-nums"
                style={{ color: "var(--color-qk-primary)" }}
              >
                {streak.count}
              </motion.span>
              <span
                className="text-base font-medium"
                style={{ color: "var(--color-demo-muted)" }}
              >
                day{streak.count === 1 ? "" : "s"}
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
