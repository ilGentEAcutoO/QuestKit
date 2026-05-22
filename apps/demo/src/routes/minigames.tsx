/**
 * Mini-game corner — renders <SpinWheel> and <ScratchCard> side by side,
 * with their corresponding Lucky Spinner / Scratch Master mission cards
 * rendered in-place below the widgets so users can claim WITHOUT having
 * to navigate away to /ecommerce.
 *
 * The widgets carry their own cooldown / reveal logic. We just configure
 * a reasonable set of slices for the wheel and a celebratory prize for
 * the scratch card. Each component is keyboard accessible and respects
 * `prefers-reduced-motion`.
 *
 * Reward honesty (Phase 9 / TASK-003 — B5):
 *   Migration 0004 wires `qk.minigame.spin` → `mis_lucky_spinner` and
 *   `qk.minigame.scratch` → `mis_scratch_master`, both of which carry
 *   `reward_json = {"kind":"badge", ...}`. `POST /v1/events` never
 *   writes to the balances table (currency mints are gated behind
 *   `POST /v1/missions/:id/claim` with a currency-kind reward — see
 *   `workers/api/src/db/schema.ts::claimMission`). So a toast that says
 *   "+30 coin" after a scratch would be a LIE — the coin never lands.
 *
 *   This route now hands a badge-shaped reward to the toast surface
 *   and to `setLastWheelLabel`, so the visible celebration matches the
 *   ground truth (every spin/scratch ticks the badge mission progress;
 *   no currency moves until a future Phase 10 makes that explicit).
 *   Slice labels stay visually varied so the wheel still feels like a
 *   wheel; the rewards under the hood are all `lucky_spinner` badge.
 *
 * In-place mission cards (F5-a / TASK-014 — v0.1.13):
 *   Production inspection of v0.1.12 surfaced a UX gap: spinning /
 *   scratching ticked server-side mission progress correctly and the
 *   `mis_lucky_spinner` / `mis_scratch_master` cards flipped to
 *   "completed" on /ecommerce, but users on /minigames never saw the
 *   Claim button because the cards only lived in the global "Active
 *   missions" list on the e-commerce route. After 5 spins the user
 *   would conclude "badge doesn't work" — they never navigated away to
 *   find the Claim CTA.
 *
 *   Fix: render the two minigame missions in-place below the widgets
 *   via the same `useMissions()` + `MissionCard` + `useMissionClaim()`
 *   pattern established for /streaming (TASK-002 / Phase 9). We filter
 *   the full mission list to the two minigame IDs rather than scoping
 *   by `campaignId` because these missions live in the default global
 *   campaign — there's no `camp_minigame_*` to key on. Wiring
 *   `useMissionClaim({ onClaimed: refetch })` preserves the v0.1.9
 *   SSE-degraded backstop so the card converges to status="claimed"
 *   even if the SSE `mission.claimed` broadcast drops.
 */
import {
  MissionCard,
  ScratchCard,
  SpinWheel,
  type SpinWheelSlice,
  useEvent,
  useMissions,
} from "@questkit/react";
import { type ReactElement, useState } from "react";

import { useDemoToast } from "../components/DemoToastHost";
import { SceneHeading } from "../components/SceneHeading";
import { useMissionClaim } from "../lib/useMissionClaim";

// Mission IDs the in-place cards pin to. Pinned to the two minigame
// missions seeded by migration 0004 — keep this list in lockstep with
// the rules that drive `qk.minigame.spin` and `qk.minigame.scratch`.
// If a future Phase 10 adds new minigame missions, append their IDs
// here so they show up alongside the widgets that produce them.
const MINIGAME_MISSION_IDS: readonly string[] = [
  "mis_lucky_spinner",
  "mis_scratch_master",
];

/**
 * Wheel slices — every reward is the Lucky Spinner badge.
 *
 * The labels are purely cosmetic celebration text that decorate the
 * SVG slice; the actual reward (passed to `onSpin` → `showToast`) is
 * always `{kind:"badge", badgeId:"lucky_spinner"}` because that's
 * what the server-side `mis_lucky_spinner` mission grants. Keeping
 * 6 distinct labels preserves the visual variety of the wheel.
 */
const WHEEL_SLICES: SpinWheelSlice[] = [
  {
    label: "Lucky spin!",
    reward: { kind: "badge", badgeId: "lucky_spinner" },
    weight: 4,
    color: "#f59e0b",
  },
  {
    label: "Streak +1!",
    reward: { kind: "badge", badgeId: "lucky_spinner" },
    weight: 3,
    color: "#10b981",
  },
  {
    label: "Sparkle!",
    reward: { kind: "badge", badgeId: "lucky_spinner" },
    weight: 2,
    color: "#3b82f6",
  },
  {
    label: "Bonus tick!",
    reward: { kind: "badge", badgeId: "lucky_spinner" },
    weight: 1,
    color: "#8b5cf6",
  },
  {
    label: "Big spin!",
    reward: { kind: "badge", badgeId: "lucky_spinner" },
    weight: 1,
    color: "#ef4444",
  },
  {
    label: "Top combo!",
    reward: { kind: "badge", badgeId: "lucky_spinner" },
    weight: 4,
    color: "#06b6d4",
  },
];

export function MiniGamesRoute(): ReactElement {
  const { show: showToast } = useDemoToast();
  const { fireEvent } = useEvent();
  const [lastWheelLabel, setLastWheelLabel] = useState<string | null>(null);
  const [scratchRevealed, setScratchRevealed] = useState<boolean>(false);

  // Subscribe to the full mission list and filter client-side to the two
  // minigame IDs. We don't pass a `campaignId` because these missions
  // live in the global campaign — there's no minigame-only campaign to
  // scope by. Iterating MissionCard manually (rather than reusing
  // <MissionList />) keeps us aligned with the /streaming pattern from
  // TASK-002 and lets us render a friendly empty state while the fetch
  // is in flight without depending on MissionList's skeleton UI.
  const missionsState = useMissions();
  const handleClaim = useMissionClaim({ onClaimed: missionsState.refetch });
  const minigameMissions = (missionsState.data?.missions ?? []).filter((m) =>
    MINIGAME_MISSION_IDS.includes(m.id),
  );

  return (
    <div className="space-y-8">
      <SceneHeading
        emoji="🎰"
        title="Mini-game corner"
        description="Two showcase widgets shipped with @questkit/react. Both honour reduced-motion preferences and announce wins to assistive tech."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section
          aria-labelledby="wheel-heading"
          className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border p-6"
          style={{
            background: "var(--color-demo-surface-2)",
            borderColor: "var(--color-demo-border)",
          }}
        >
          <h3
            id="wheel-heading"
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-demo-muted)" }}
          >
            Spin Wheel
          </h3>
          <SpinWheel
            id="demo-spin"
            rewards={WHEEL_SLICES}
            cooldownMs={0}
            onSpin={(reward) => {
              const slice = WHEEL_SLICES.find((s) => s.reward === reward);
              setLastWheelLabel(slice?.label ?? "Reward");
              showToast(reward);
              // Fire a synthetic event so the EventLog drawer reflects
              // the spin in the same live-update timeline as ecommerce
              // purchases and daily check-ins. This event matches
              // server-side mission `mis_lucky_spinner` (migration
              // 0004): each spin advances badge progress by 1, and the
              // 5th completes the mission. No currency is minted by
              // this event — coin mints only happen on the claim
              // endpoint when the mission's reward is currency-kind.
              void fireEvent({
                name: "qk.minigame.spin",
                payload: {
                  game: "spin_wheel",
                  reward,
                },
              });
            }}
          />
          <p
            className="min-h-[1.25rem] text-sm"
            style={{ color: "var(--color-demo-muted)" }}
            aria-live="polite"
          >
            {lastWheelLabel ? `Won: ${lastWheelLabel}` : "Press spin to start."}
          </p>
        </section>

        <section
          aria-labelledby="scratch-heading"
          className="flex flex-col items-center gap-4 rounded-[var(--radius-card)] border p-6"
          style={{
            background: "var(--color-demo-surface-2)",
            borderColor: "var(--color-demo-border)",
          }}
        >
          <h3
            id="scratch-heading"
            className="text-sm font-semibold uppercase tracking-wide"
            style={{ color: "var(--color-demo-muted)" }}
          >
            Scratch Card
          </h3>
          <ScratchCard
            overlayLabel="Scratch to win"
            prize={
              <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                <span aria-hidden="true" className="text-4xl">
                  🎁
                </span>
                <span className="text-lg font-bold text-[color:var(--color-qk-primary)]">
                  Scratch Master
                </span>
                <span className="text-xs text-[color:var(--color-demo-muted)]">
                  Tap and drag to reveal
                </span>
              </div>
            }
            onReveal={() => {
              setScratchRevealed(true);
              // Honest reward shape — matches `mis_scratch_master` from
              // migration 0004. Coin minting is NOT triggered by event
              // ingest; see file-level comment for the contract.
              showToast({ kind: "badge", badgeId: "scratch_master" });
              void fireEvent({
                name: "qk.minigame.scratch",
                payload: { game: "scratch_card" },
              });
            }}
          />
          <p
            className="min-h-[1.25rem] text-sm"
            style={{ color: "var(--color-demo-muted)" }}
            aria-live="polite"
          >
            {scratchRevealed
              ? "Reveal complete! Scratch Master progress +1."
              : "Drag your finger or mouse across the card."}
          </p>
        </section>
      </div>

      <section
        aria-labelledby="minigame-missions-heading"
        className="space-y-3"
      >
        <h3
          id="minigame-missions-heading"
          className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-demo-muted)]"
        >
          Mini-game missions
        </h3>
        <p className="text-xs" style={{ color: "var(--color-demo-muted)" }}>
          Each spin or scratch ticks one of these missions. Once a card shows{" "}
          {`"Claim"`}, press it right here — no need to leave the mini-game
          corner.
        </p>
        {missionsState.isLoading ? (
          <p
            role="status"
            className="text-sm"
            style={{ color: "var(--color-demo-muted)" }}
          >
            Loading mini-game missions…
          </p>
        ) : minigameMissions.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {minigameMissions.map((mission) => (
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
            No mini-game missions are active right now.
          </p>
        )}
      </section>

      <section
        className="rounded-[var(--radius-card)] border p-5 text-sm"
        style={{
          background: "var(--color-demo-surface-2)",
          borderColor: "var(--color-demo-border)",
        }}
      >
        <h3
          className="mb-2 text-sm font-semibold uppercase tracking-wide"
          style={{ color: "var(--color-demo-muted)" }}
        >
          How the mini-games connect to QuestKit
        </h3>
        <ul
          className="list-disc space-y-1 pl-5"
          style={{ color: "var(--color-demo-muted)" }}
        >
          <li>
            Each widget reads CSS tokens from{" "}
            <code>@questkit/react/styles.css</code> — switch theme in the
            DevTools panel to see them re-skin.
          </li>
          <li>
            Each spin ticks the <strong>Lucky Spinner</strong> badge mission;
            each scratch ticks <strong>Scratch Master</strong>. No currency is
            minted by these events — the badge unlocks on claim.
          </li>
          <li>
            The cooldown is persisted to <code>localStorage</code> per wheel id;
            the demo sets it to 0 so you can spin repeatedly.
          </li>
        </ul>
      </section>
    </div>
  );
}
