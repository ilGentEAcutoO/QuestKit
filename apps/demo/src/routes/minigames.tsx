/**
 * Mini-game corner — renders <SpinWheel> and <ScratchCard> side by side.
 *
 * The widgets carry their own cooldown / reveal logic. We just configure
 * a reasonable set of slices for the wheel and a celebratory prize for
 * the scratch card. Each component is keyboard accessible and respects
 * `prefers-reduced-motion`.
 */
import {
  ScratchCard,
  SpinWheel,
  type SpinWheelSlice,
  useEvent,
} from "@questkit/react";
import { type ReactElement, useState } from "react";

import { useDemoToast } from "../components/DemoToastHost";
import { SceneHeading } from "../components/SceneHeading";

const WHEEL_SLICES: SpinWheelSlice[] = [
  {
    label: "+10 coin",
    reward: { kind: "currency", currency: "coin", amount: 10 },
    weight: 4,
    color: "#f59e0b",
  },
  {
    label: "+25 coin",
    reward: { kind: "currency", currency: "coin", amount: 25 },
    weight: 3,
    color: "#10b981",
  },
  {
    label: "+50 coin",
    reward: { kind: "currency", currency: "coin", amount: 50 },
    weight: 2,
    color: "#3b82f6",
  },
  {
    label: "+1 gem",
    reward: { kind: "currency", currency: "gem", amount: 1 },
    weight: 1,
    color: "#8b5cf6",
  },
  {
    label: "Badge",
    reward: { kind: "badge", badgeId: "lucky_spinner" },
    weight: 1,
    color: "#ef4444",
  },
  {
    label: "+5 coin",
    reward: { kind: "currency", currency: "coin", amount: 5 },
    weight: 4,
    color: "#06b6d4",
  },
];

export function MiniGamesRoute(): ReactElement {
  const { show: showToast } = useDemoToast();
  const { fireEvent } = useEvent();
  const [lastWheelLabel, setLastWheelLabel] = useState<string | null>(null);
  const [scratchRevealed, setScratchRevealed] = useState<boolean>(false);

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
              // purchases and daily check-ins. The server has no mission
              // matching `qk.minigame.spin`, so the event is recorded but
              // no mission progress is broadcast — the visual celebration
              // is the entire payoff here.
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
                  +30 coin
                </span>
                <span className="text-xs text-[color:var(--color-demo-muted)]">
                  Tap and drag to reveal
                </span>
              </div>
            }
            onReveal={() => {
              setScratchRevealed(true);
              showToast({ kind: "currency", currency: "coin", amount: 30 });
              void fireEvent({
                name: "qk.minigame.scratch",
                payload: { game: "scratch_card", amount: 30 },
              });
            }}
          />
          <p
            className="min-h-[1.25rem] text-sm"
            style={{ color: "var(--color-demo-muted)" }}
            aria-live="polite"
          >
            {scratchRevealed
              ? "Won: +30 coin"
              : "Drag your finger or mouse across the card."}
          </p>
        </section>
      </div>

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
            Wins emit a reward via <code>useRewardClaimToast</code> — same
            surface the API uses on a real claim.
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
