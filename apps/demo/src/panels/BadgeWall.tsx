/**
 * BadgeWall — top-left floating panel that surfaces every badge the demo
 * user has actually earned. v0.1.6 hotfix for the gap surfaced by the
 * v0.1.5 walkthrough: prior to this panel, "earning" a badge produced a
 * 3-second toast and a "Claimed" MissionCard state — then vanished. There
 * was nowhere to see the badge collection.
 *
 * Source of truth — `useMissions().progress`: a badge is "earned" iff its
 * backing mission has `progress.status === "claimed"` AND the mission's
 * `reward.kind === "badge"`. No new DB table, no new endpoint: the
 * existing mission-claim path is already the persistence layer for
 * badges. The mapping is one-to-one because every server-defined badge
 * (migrations 0002/0003/0004) is the reward of exactly one mission.
 *
 * Local-only badges (e.g. the streaming route's `binge_starter`
 * celebration toast, which has no backing mission) are NOT shown — by
 * design. Those are pure UX flourishes; if we surfaced them here, a
 * reload would silently drop them and confuse the user.
 */
import { useMissions } from "@questkit/react";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactElement, useMemo, useState } from "react";

interface EarnedBadge {
  badgeId: string;
  /** Display title — pulled from the mission whose reward minted this badge. */
  missionTitle: string;
  /** Server-assigned `updatedAt` of the claimed row, ms since epoch. */
  earnedAt: number;
}

/**
 * Display title + emoji per badge id. Mirror the seed migrations so
 * a new server-side badge added in `0005_*.sql` gets a `?` fallback
 * surface (rather than a broken render) until the demo catches up.
 */
const BADGE_DISPLAY: Record<string, { title: string; emoji: string }> = {
  power_user: { title: "Power User", emoji: "⚡" },
  curious_mind: { title: "Curious Mind", emoji: "🔍" },
  daily_visitor: { title: "Daily Visitor", emoji: "📅" },
  lucky_spinner: { title: "Lucky Spinner", emoji: "🎰" },
  scratch_master: { title: "Scratch Master", emoji: "🎫" },
};

function formatEarnedAt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function BadgeWall(): ReactElement {
  const [open, setOpen] = useState<boolean>(false);
  // Pulls the full mission set; we filter for badge-rewarded + claimed below.
  // Same-shaped hook the routes use — caching is at the SDK level, so this
  // does not generate a second authoritative fetch.
  const missionsState = useMissions({});

  const earned = useMemo<EarnedBadge[]>(() => {
    const data = missionsState.data;
    if (data === undefined) return [];
    const out: EarnedBadge[] = [];
    for (const mission of data.missions) {
      if (mission.reward.kind !== "badge") continue;
      const p = data.progress[mission.id];
      if (p === undefined || p.status !== "claimed") continue;
      out.push({
        badgeId: mission.reward.badgeId,
        missionTitle: mission.title,
        earnedAt: p.updatedAt,
      });
    }
    // Newest first.
    out.sort((a, b) => b.earnedAt - a.earnedAt);
    return out;
  }, [missionsState.data]);

  const count = earned.length;

  return (
    <div className="fixed left-4 top-20 z-40 sm:top-24">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="qk-badge-wall-panel"
        aria-label={
          open
            ? `Close badges panel (${count} earned)`
            : `Open badges panel (${count} earned)`
        }
        className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium shadow-lg transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
        style={{
          background: "var(--color-demo-surface-2)",
          color: "var(--color-demo-ink)",
          borderColor: "var(--color-demo-border)",
        }}
      >
        <span aria-hidden="true">🏆</span>
        <span>Badges</span>
        <span
          aria-hidden="true"
          className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
          style={{
            background:
              count > 0 ? "var(--color-qk-coin)" : "var(--color-demo-border)",
            color: count > 0 ? "var(--color-qk-fg)" : "var(--color-demo-muted)",
          }}
        >
          {count}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.aside
            id="qk-badge-wall-panel"
            role="region"
            aria-label="Earned badges"
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="absolute left-0 top-12 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-card)] border shadow-2xl"
            style={{
              background: "var(--color-demo-surface)",
              borderColor: "var(--color-demo-border)",
            }}
          >
            <header
              className="flex items-center justify-between gap-2 border-b px-4 py-2.5"
              style={{ borderColor: "var(--color-demo-border)" }}
            >
              <div>
                <h3 className="text-sm font-semibold">Earned badges</h3>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-demo-muted)" }}
                >
                  Claim missions to unlock the rest.
                </p>
              </div>
              <span
                className="text-xs tabular-nums"
                style={{ color: "var(--color-demo-muted)" }}
              >
                {count} / {Object.keys(BADGE_DISPLAY).length}
              </span>
            </header>

            {missionsState.isLoading ? (
              <p
                role="status"
                className="px-4 py-6 text-center text-sm"
                style={{ color: "var(--color-demo-muted)" }}
              >
                Loading missions…
              </p>
            ) : count === 0 ? (
              <div className="px-4 py-6 text-center">
                <div aria-hidden="true" className="text-3xl">
                  ✨
                </div>
                <p
                  className="mt-2 text-sm"
                  style={{ color: "var(--color-demo-muted)" }}
                >
                  No badges yet — claim a mission to earn your first!
                </p>
              </div>
            ) : (
              <ul
                className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3"
                aria-label="Earned badges grid"
              >
                {earned.map((b) => {
                  const display = BADGE_DISPLAY[b.badgeId] ?? {
                    title: b.missionTitle,
                    emoji: "🏅",
                  };
                  return (
                    <li
                      key={b.badgeId}
                      className="flex flex-col items-center gap-1 rounded-[var(--radius-card)] border p-3 text-center"
                      style={{
                        background: "var(--color-demo-surface-2)",
                        borderColor: "var(--color-demo-border)",
                      }}
                    >
                      <span
                        aria-hidden="true"
                        className="text-3xl"
                        title={display.title}
                      >
                        {display.emoji}
                      </span>
                      <span className="text-xs font-semibold leading-tight">
                        {display.title}
                      </span>
                      <span
                        className="text-[10px] tabular-nums"
                        style={{ color: "var(--color-demo-muted)" }}
                      >
                        {formatEarnedAt(b.earnedAt)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
