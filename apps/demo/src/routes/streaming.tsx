/**
 * Streaming scenario — 6 video tiles, "Watch" fires video.watched.
 *
 * Aligned with the seed missions in 0002:
 *   - Daily Watcher (daily, count 1)
 *   - Documentary Buff (lifetime, genre = "documentary", count 3)
 *   - Marathon Week (weekly, duration_sec >= 1800, count 4)
 *
 * The fired payload carries genre + duration so the rule engine sees the
 * filters. We also keep a local counter of "watched today" so the
 * streaming-specific badge unlock at 3 stays visible even when the
 * server is offline (degraded mode demo).
 */
import { MissionCard, useEvent, useMissions } from "@questkit/react";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type ReactElement, useState } from "react";
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

export function StreamingRoute(): ReactElement {
  const { fireEvent, isFiring } = useEvent();
  const { show: showToast } = useDemoToast();
  const reduced = useReducedMotion();
  const handleClaim = useMissionClaim();
  const [watchedToday, setWatchedToday] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [bingeUnlocked, setBingeUnlocked] = useState<boolean>(false);

  // Surface a single mission preview by reusing useMissions filtered to
  // the streaming campaign — the full list lives in the EventLog/missions
  // sections below.
  const missionsState = useMissions({ campaignId: "camp_stream_2026q2" });

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
      const nextCount = watchedToday + 1;
      setWatchedToday(nextCount);
      if (nextCount === 3) {
        // Surface the unlock with a toast; the server-side rule engine
        // will fire the real reward but this gives the demo immediacy.
        showToast({ kind: "badge", badgeId: "binge_starter" });
        setBingeUnlocked(true);
        // Allow re-triggering for replay (resets after the burst).
        setTimeout(() => setBingeUnlocked(false), 1200);
      }
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
        aria-label="Today's progress"
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
                  watchedToday >= 3
                    ? "var(--color-qk-coin)"
                    : "var(--color-demo-surface)",
              }}
            >
              {watchedToday >= 3 ? "🏆" : "📺"}
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
            <p className="text-sm font-semibold">Watched today</p>
            <p className="text-xs" style={{ color: "var(--color-demo-muted)" }}>
              Unlock the Binge Starter badge at 3.
            </p>
          </div>
        </div>
        <div
          className="flex items-center gap-1.5"
          aria-label={`${watchedToday} of 3 watched`}
        >
          {Array.from({ length: 3 }).map((_, i) => (
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
            {watchedToday}/3
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
