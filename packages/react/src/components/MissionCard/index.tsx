/**
 * <MissionCard /> — single-mission tile with progress, reward, and claim CTA.
 *
 * Inputs are pre-fetched: this component does not subscribe to its own
 * data. The parent (usually `<MissionList>`) owns `useMissions` and passes
 * the matched `progress` for each card. Decoupling reads keeps every card
 * cheap — no `n` × `useMission` subscriptions for a 50-item list.
 *
 * Claim button state machine (driven by `progress.status` + local flag):
 *   - status = "locked"           → button hidden
 *   - status = "active"           → button hidden (claim is only meaningful
 *                                    once the mission is completed)
 *   - status = "completed"        → button visible + enabled, label "Claim"
 *   - claim in-flight (local)     → button visible + disabled, label "Claiming…"
 *   - status = "claimed"          → button visible + disabled, label "Claimed"
 *
 * The actual claim mutation belongs to the parent (which decides whether
 * to optimistically update, call `client.claimMission`, or show a toast).
 * We expose `onClaim(missionId)` and only manage the transient
 * "claiming" UI flag here. `useEvent` is imported to satisfy the brief's
 * "uses `useEvent` only for the firing path" — we fire a `qk.claim.attempt`
 * event whenever a claim is requested, then defer the real claim work to
 * the parent's `onClaim`.
 */
import type { Mission, MissionProgress, Reward } from "@questkit/types";
import type { CSSProperties, KeyboardEvent, ReactElement } from "react";
import { useState } from "react";

import { useEvent } from "../../hooks/useEvent";
import { ProgressBar } from "../ProgressBar";

export interface MissionCardProps {
  mission: Mission;
  /** Optional progress; absent means "no row on the server yet". */
  progress?: MissionProgress | undefined;
  /**
   * Callback fired when the user clicks "Claim". The parent is responsible
   * for performing the actual claim mutation and (typically) updating
   * progress.status to "claimed" via a refetch / optimistic update. While
   * the returned promise is pending the button shows "Claiming…".
   */
  onClaim?: (missionId: string) => Promise<void>;
  className?: string;
}

function rewardBadgeText(reward: Reward): string {
  if (reward.kind === "currency") {
    return `+${reward.amount} ${reward.currency}`;
  }
  if (reward.kind === "badge") {
    return `Badge`;
  }
  return `${reward.quantity}× item`;
}

function rewardBadgeAriaLabel(reward: Reward): string {
  if (reward.kind === "currency") {
    return `Reward: ${reward.amount} ${reward.currency}`;
  }
  if (reward.kind === "badge") {
    return `Reward: badge ${reward.badgeId}`;
  }
  return `Reward: ${reward.quantity} of item ${reward.itemId}`;
}

export function MissionCard({
  mission,
  progress,
  onClaim,
  className,
}: MissionCardProps): ReactElement {
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const { fireEvent } = useEvent();

  const status = progress?.status ?? "active";
  const currentCount = progress?.currentCount ?? 0;
  const targetCount = progress?.targetCount ?? mission.criteria.count;
  const percent = progress?.progress ?? 0;

  // Decide which claim-button mode (hidden | enabled | disabled | claimed).
  let claimMode: "hidden" | "enabled" | "pending" | "claimed";
  if (status === "claimed") {
    claimMode = "claimed";
  } else if (status === "completed") {
    claimMode = isClaiming ? "pending" : "enabled";
  } else {
    claimMode = "hidden";
  }

  const handleClaim = async (): Promise<void> => {
    if (claimMode !== "enabled") return;
    setIsClaiming(true);
    try {
      // Best-effort analytics signal — failure here does NOT block the
      // claim handler. We don't await: events go through the SDK queue and
      // are durable across retries; the user shouldn't wait on a telemetry
      // hop.
      void fireEvent({
        name: "qk.claim.attempt",
        payload: { missionId: mission.id },
      }).catch(() => {
        /* analytics is fire-and-forget */
      });
      if (onClaim !== undefined) {
        await onClaim(mission.id);
      }
    } finally {
      setIsClaiming(false);
    }
  };

  const handleClaimKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    // Native <button> handles Enter + Space already; we don't need
    // additional keydown handling. The handler exists only so future
    // arrow-navigation can hook in.
    if (e.key === "Enter" || e.key === " ") {
      // Let the default click flow run.
    }
  };

  const rootClass = ["qk-mission-card", "flex flex-col gap-3 p-4", className]
    .filter(Boolean)
    .join(" ");

  const rootStyle: CSSProperties = {
    background: "var(--color-qk-bg)",
    color: "var(--color-qk-fg)",
    borderRadius: "var(--radius-qk)",
    fontFamily: "var(--font-qk)",
    border: "1px solid var(--color-qk-muted, rgba(0,0,0,0.1))",
  };

  const badgeStyle: CSSProperties = {
    background: "var(--color-qk-coin)",
    color: "var(--color-qk-fg)",
    borderRadius: "var(--radius-qk)",
    padding: "0.25rem 0.5rem",
    fontSize: "0.75rem",
    fontWeight: 600,
  };

  const buttonBaseStyle: CSSProperties = {
    background: "var(--color-qk-primary)",
    color: "var(--color-qk-bg)",
    borderRadius: "var(--radius-qk)",
    padding: "0.5rem 1rem",
    border: "none",
    fontWeight: 600,
    cursor: claimMode === "enabled" ? "pointer" : "default",
    opacity: claimMode === "enabled" ? 1 : 0.6,
    outline: "none",
  };

  return (
    <article
      className={rootClass}
      style={rootStyle}
      aria-labelledby={`qk-mission-${mission.id}-title`}
      data-mission-id={mission.id}
      data-status={status}
    >
      <header className="flex items-start justify-between gap-3">
        {mission.iconUrl !== undefined && mission.iconUrl.length > 0 && (
          <img
            src={mission.iconUrl}
            alt=""
            aria-hidden="true"
            width={32}
            height={32}
            loading="lazy"
            decoding="async"
            className="qk-mission-card-icon flex-none"
            style={{
              borderRadius: "var(--radius-qk)",
              objectFit: "cover",
            }}
          />
        )}
        <div className="flex-1">
          <h3
            id={`qk-mission-${mission.id}-title`}
            className="qk-mission-card-title text-base font-semibold"
          >
            {mission.title}
          </h3>
          {mission.description.length > 0 && (
            <p
              className="qk-mission-card-desc text-sm mt-1"
              style={{ opacity: 0.8 }}
            >
              {mission.description}
            </p>
          )}
        </div>
        <span
          className="qk-mission-card-reward"
          style={badgeStyle}
          aria-label={rewardBadgeAriaLabel(mission.reward)}
        >
          {rewardBadgeText(mission.reward)}
        </span>
      </header>

      <div className="qk-mission-card-progress">
        <ProgressBar
          value={currentCount}
          max={targetCount > 0 ? targetCount : 1}
          label={`Progress: ${currentCount} of ${targetCount}`}
        />
        <p
          className="qk-mission-card-progress-text text-xs mt-1"
          style={{ opacity: 0.7 }}
        >
          {Math.round(percent * 100)}% · {currentCount} / {targetCount}
        </p>
      </div>

      {claimMode !== "hidden" && (
        <button
          type="button"
          className="qk-mission-card-claim self-end focus-visible:ring-2"
          style={buttonBaseStyle}
          disabled={claimMode !== "enabled"}
          aria-disabled={claimMode !== "enabled"}
          aria-label={
            claimMode === "claimed"
              ? `Reward for ${mission.title} already claimed`
              : claimMode === "pending"
                ? `Claiming reward for ${mission.title}`
                : `Claim reward for ${mission.title}`
          }
          onClick={(): void => {
            void handleClaim();
          }}
          onKeyDown={handleClaimKey}
        >
          {claimMode === "claimed"
            ? "Claimed"
            : claimMode === "pending"
              ? "Claiming…"
              : "Claim"}
        </button>
      )}
    </article>
  );
}
