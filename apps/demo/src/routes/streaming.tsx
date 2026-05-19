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
import {
  MissionCard,
  useEvent,
  useMissions,
  useRewardClaimToast,
} from "@questkit/react";
import { motion } from "framer-motion";
import { type ReactElement, useState } from "react";

import { SceneHeading } from "../components/SceneHeading";

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

export function StreamingRoute(): ReactElement {
  const { fireEvent, isFiring } = useEvent();
  const { show: showToast } = useRewardClaimToast();
  const [watchedToday, setWatchedToday] = useState<number>(0);
  const [busy, setBusy] = useState<string | null>(null);

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
        <div>
          <p className="text-sm font-semibold">Watched today</p>
          <p className="text-xs" style={{ color: "var(--color-demo-muted)" }}>
            Unlock the Binge Starter badge at 3.
          </p>
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
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
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
