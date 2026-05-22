/**
 * Streaming scenario — 6 video tiles, "Watch" fires video.watched.
 *
 * Aligned with the seed missions in 0002:
 *   - Daily Watcher (daily, count 1)
 *   - Curious Mind (lifetime, genre = "documentary", count 3)
 *   - Deep Diver (weekly, duration_sec >= 1800, count 10)
 *
 * The "Today's progress" widget mirrors the server-side Curious Mind
 * counter (mis_stream_documentary_3): it's the only 3-target streaming
 * mission and matches the widget's existing copy ("Hit 3 to unlock the
 * Binge Starter badge"). Reading from useMissions() means the widget
 * always agrees with the MissionCard further down, and crucially it
 * reflects the `status: "claimed"` flip after the user claims — the bug
 * B3/D1 fix from Phase 9 / TASK-002.
 */
import { MissionCard, useEvent, useMissions } from "@questkit/react";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { useDemoToast } from "../components/DemoToastHost";

import { SceneHeading } from "../components/SceneHeading";
import { useMissionClaim } from "../lib/useMissionClaim";

interface Video {
  id: string;
  title: string;
  genre: "drama" | "documentary" | "comedy" | "action" | "sport";
  durationSec: number;
  emoji: string;
}

const VIDEOS: Video[] = [
  {
    id: "v_doc_planet",
    title: "Planet Earth III",
    genre: "documentary",
    durationSec: 3300,
    emoji: "🌍",
  },
  {
    id: "v_drama_succession",
    title: "Succession Recap",
    genre: "drama",
    durationSec: 1200,
    emoji: "🎬",
  },
  {
    id: "v_action_dunes",
    title: "Dunes of Aerith",
    genre: "action",
    durationSec: 2700,
    emoji: "⚔️",
  },
  {
    id: "v_comedy_lateshow",
    title: "Late Show: Episode 42",
    genre: "comedy",
    durationSec: 1800,
    emoji: "🎤",
  },
  {
    id: "v_sport_match",
    title: "World Cup Quarter Final",
    genre: "sport",
    durationSec: 6300,
    emoji: "⚽",
  },
  {
    id: "v_doc_oceans",
    title: "Blue Worlds",
    genre: "documentary",
    durationSec: 4200,
    emoji: "🐋",
  },
];

// 7-point ring around the badge — pre-computed angles for deterministic SSR.
const CONFETTI_ANGLES = [0, 51, 103, 154, 206, 257, 309];

// Mission whose currentCount drives the "Today's progress" widget. Pinned
// to the 3-target streaming mission (Curious Mind) — see migration 0002.
// We pick this rather than the 1-target Daily Watcher because the widget's
// copy explicitly says "Unlock the Binge Starter badge at 3." The heading
// + aria-labels were retitled to "Documentaries today" in v0.1.13 (F5-c /
// TASK-014) so the documentary-only discriminator is explicit — without
// that wording users clicked drama/comedy/sport videos and were confused
// that the counter didn't tick (those events don't match this mission's
// filter, by design).
const STREAM_BINGE_MISSION_ID = "mis_stream_documentary_3";
const STREAM_BINGE_TARGET = 3;

export function StreamingRoute(): ReactElement {
  const { fireEvent, isFiring } = useEvent();
  const { show: showToast } = useDemoToast();
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState<string | null>(null);
  const [bingeUnlocked, setBingeUnlocked] = useState<boolean>(false);

  // Surface a single mission preview by reusing useMissions filtered to
  // the streaming campaign — the full list lives in the EventLog/missions
  // sections below.
  const missionsState = useMissions({ campaignId: "camp_stream_2026q2" });

  // Wire the claim handler with a refetch fallback so the UI converges to
  // status="claimed" even if the SSE `mission.claimed` event drops — see
  // useMissionClaim's docstring (Phase 9 / TASK-001 Cluster C1).
  const handleClaim = useMissionClaim({ onClaimed: missionsState.refetch });

  // Derive the "Today's progress" count from server state. The optimistic
  // path in useMissions already bumps currentCount synchronously on a
  // successful fireEvent (TASK-006), so this stays responsive without a
  // local mirror. Clamp via Math.min to match MissionCard's display
  // contract — never overshoot the target even if the server briefly
  // counts past it (defense in depth, mirrors MissionCard line 90-91).
  const bingeProgress = missionsState.data?.progress[STREAM_BINGE_MISSION_ID];
  const rawCount = bingeProgress?.currentCount ?? 0;
  const targetCount = bingeProgress?.targetCount ?? STREAM_BINGE_TARGET;
  const watchedToday = Math.min(rawCount, targetCount);

  // Celebration trigger: fire the toast + confetti when the SERVER count
  // crosses into target territory during this session. We use a ref pair
  // to remember (a) whether we've captured the initial count yet and (b)
  // the last count we saw — so the effect only fires on a strictly
  // increasing transition INTO the target, not on the first render after
  // a reload when the user already has count >= target from a prior visit.
  const prevCountRef = useRef<number>(0);
  const hasSeenInitialRef = useRef<boolean>(false);
  useEffect(() => {
    // Wait for the initial useMissions fetch to resolve before we trust
    // the count. Otherwise we'd capture 0 on every render and falsely
    // fire when the real data lands above the target.
    if (!missionsState.isSuccess) return undefined;
    if (!hasSeenInitialRef.current) {
      // First post-fetch render: snapshot the count and skip the trigger.
      // If the user already hit the target before this visit, we don't
      // re-celebrate.
      hasSeenInitialRef.current = true;
      prevCountRef.current = watchedToday;
      return undefined;
    }
    const prev = prevCountRef.current;
    if (prev < STREAM_BINGE_TARGET && watchedToday >= STREAM_BINGE_TARGET) {
      showToast({ kind: "badge", badgeId: "binge_starter" });
      setBingeUnlocked(true);
      const timeout = window.setTimeout(() => setBingeUnlocked(false), 1200);
      prevCountRef.current = watchedToday;
      return () => {
        window.clearTimeout(timeout);
      };
    }
    prevCountRef.current = watchedToday;
    return undefined;
  }, [watchedToday, showToast, missionsState.isSuccess]);

  async function handleWatch(video: Video): Promise<void> {
    setBusy(video.id);
    try {
      await fireEvent({
        name: "video.watched",
        payload: {
          videoId: video.id,
          genre: video.genre,
          duration_sec: video.durationSec,
        },
      });
      // No local counter to bump — useMissions handles optimistic +1
      // for any mission whose criteria matched server-side. The
      // celebration trigger lives in the useEffect above, driven by
      // the server-derived count crossing STREAM_BINGE_TARGET.
    } catch {
      // EventLog panel surfaces fire failures.
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <SceneHeading
        emoji="📺"
        title="Streaming corner"
        description="Press Watch on a clip to fire video.watched. Hit 3 in a session to unlock the Binge Starter badge."
      />

      <section
        aria-label="Today's documentary progress"
        className="flex flex-col gap-3 rounded-[var(--radius-card)] border p-4 sm:flex-row sm:items-center sm:justify-between"
        style={{
          background: "var(--color-demo-surface-2)",
          borderColor: "var(--color-demo-border)",
        }}
      >
        <div className="flex items-center gap-3">
          <div className="relative">
            <motion.div
              animate={
                bingeUnlocked && !reduced
                  ? { scale: [1, 1.25, 1], rotate: [0, -8, 8, 0] }
                  : { scale: 1, rotate: 0 }
              }
              transition={{ duration: 0.6, ease: "easeOut" }}
              aria-hidden="true"
              className="grid h-10 w-10 place-items-center rounded-full text-xl"
              style={{
                background:
                  watchedToday >= targetCount
                    ? "var(--color-qk-coin)"
                    : "var(--color-demo-surface)",
              }}
            >
              {watchedToday >= targetCount ? "🏆" : "📺"}
            </motion.div>
            <AnimatePresence>
              {bingeUnlocked && !reduced
                ? CONFETTI_ANGLES.map((angle, i) => (
                    <motion.span
                      key={i}
                      aria-hidden="true"
                      initial={{ opacity: 1, x: 0, y: 0, scale: 0.6 }}
                      animate={{
                        opacity: 0,
                        x: Math.cos((angle * Math.PI) / 180) * 32,
                        y: Math.sin((angle * Math.PI) / 180) * 32,
                        scale: 1,
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                      className="pointer-events-none absolute left-1/2 top-1/2 block h-1.5 w-1.5 rounded-full"
                      style={{
                        background:
                          i % 2 === 0
                            ? "var(--color-qk-primary)"
                            : "var(--color-qk-coin)",
                      }}
                    />
                  ))
                : null}
            </AnimatePresence>
          </div>
          <div>
            <p className="text-sm font-semibold">Documentaries today</p>
            <p className="text-xs" style={{ color: "var(--color-demo-muted)" }}>
              Unlock the Binge Starter badge at {targetCount}.
            </p>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5"
          aria-label={`${watchedToday} of ${targetCount} documentaries watched today`}
        >
          {Array.from({ length: targetCount }).map((_, i) => (
            <span
              key={i}
              aria-hidden="true"
              className="h-2.5 w-10 rounded-full transition-all"
              style={{
                background:
                  i < watchedToday
                    ? "var(--color-qk-primary)"
                    : "var(--color-demo-border)",
              }}
            />
          ))}
          <span
            className="ml-2 text-sm font-semibold tabular-nums"
            aria-live="polite"
          >
            {watchedToday}/{targetCount}
          </span>
        </div>
      </section>

      <section aria-labelledby="library-heading" className="space-y-3">
        <h3
          id="library-heading"
          className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-demo-muted)]"
        >
          Library
        </h3>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {VIDEOS.map((video) => (
            <motion.li
              key={video.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border p-4"
              style={{
                background: "var(--color-demo-surface-2)",
                borderColor: "var(--color-demo-border)",
              }}
            >
              <div
                aria-hidden="true"
                className="grid h-24 place-items-center rounded-md text-4xl"
                style={{ background: "var(--color-demo-surface)" }}
              >
                {video.emoji}
              </div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <h4 className="text-base font-semibold leading-snug">
                    {video.title}
                  </h4>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: "var(--color-demo-muted)" }}
                  >
                    {video.genre} · {Math.round(video.durationSec / 60)} min
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleWatch(video);
                }}
                disabled={isFiring && busy === video.id}
                aria-label={`Watch ${video.title}`}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
                style={{ background: "var(--color-qk-primary)" }}
              >
                {isFiring && busy === video.id ? "Logging…" : "Watch"}
              </button>
            </motion.li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="streaming-missions" className="space-y-3">
        <h3
          id="streaming-missions"
          className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-demo-muted)]"
        >
          Streaming missions
        </h3>
        {missionsState.isLoading ? (
          <p
            role="status"
            className="text-sm"
            style={{ color: "var(--color-demo-muted)" }}
          >
            Loading missions…
          </p>
        ) : missionsState.data && missionsState.data.missions.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {missionsState.data.missions.map((mission) => (
              <li key={mission.id}>
                <MissionCard
                  mission={mission}
                  progress={
                    missionsState.data?.progress[mission.id] ?? undefined
                  }
                  onClaim={handleClaim}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm" style={{ color: "var(--color-demo-muted)" }}>
            No streaming missions are active right now.
          </p>
        )}
      </section>
    </div>
  );
}
