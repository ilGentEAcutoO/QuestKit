/**
 * <RecommendedMissions /> — AI-curated mission suggestions (TASK-017).
 *
 * Composes `useRecommendations` (the AI call) with `useMission(id)` for
 * each returned id (so we can render full MissionCards). The AI's `reason`
 * is surfaced as a subtle caption above the cards.
 *
 * States:
 *   - loading:  role="status" + visible skeleton
 *   - error:    role="alert" with retry
 *   - empty:    neutral copy when missionIds.length === 0
 *   - loaded:   reason caption + up to 3 MissionCards
 *
 * When the response has `cached: true`, we surface a tiny "Refreshes
 * hourly" hint so the user knows the recommendations aren't real-time.
 *
 * Why per-mission `useMission` (not one bulk fetch)? The recommendations
 * route returns ids only — the full mission data lives in /v1/missions/:id
 * and each call is cheap (1× SELECT). For the cap of 3 missions this is
 * fine. If we ever want more than 10, a `getMissionsByIds` batch endpoint
 * would be a worthwhile follow-up.
 */
import type { CSSProperties, ReactElement } from "react";

import { useMission } from "../../hooks/useMission";
import { useRecommendations } from "../../hooks/useRecommendations";
import { MissionCard } from "../MissionCard";

const MAX_RECOMMENDATIONS = 3;

export interface RecommendedMissionsProps {
  /**
   * Optional claim handler forwarded to each MissionCard. Mirrors the
   * MissionList contract — the recommendations panel can either share a
   * claim handler with the rest of the UI or omit it (read-only display).
   */
  onClaim?: (missionId: string) => Promise<void>;
  className?: string;
}

/**
 * Renders a single mission slot. We delegate to `useMission(id)` per slot —
 * this is OK at our cap of 3 — and render <MissionCard> on success. Loading
 * / error per slot is silent (we don't surface per-slot spinners; the parent
 * already showed a top-level loading state).
 */
function RecommendedMissionSlot({
  id,
  onClaim,
}: {
  id: string;
  onClaim?: ((missionId: string) => Promise<void>) | undefined;
}): ReactElement | null {
  const { data, isSuccess } = useMission(id);
  if (!isSuccess || data === undefined) return null;
  return (
    <MissionCard
      mission={data.mission}
      progress={data.progress ?? undefined}
      {...(onClaim !== undefined ? { onClaim } : {})}
    />
  );
}

export function RecommendedMissions({
  onClaim,
  className,
}: RecommendedMissionsProps): ReactElement {
  const state = useRecommendations();

  const rootClass = ["qk-recommendations", "flex flex-col gap-3", className]
    .filter(Boolean)
    .join(" ");

  const rootStyle: CSSProperties = {
    background: "var(--color-qk-bg)",
    color: "var(--color-qk-fg)",
    padding: "1rem",
    borderRadius: "var(--radius-qk)",
    fontFamily: "var(--font-qk)",
  };

  if (state.isLoading) {
    return (
      <section
        className={rootClass}
        role="status"
        aria-busy="true"
        aria-label="Loading recommendations"
        style={rootStyle}
      >
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="qk-recommendations-skeleton h-24"
            style={{
              background: "var(--color-qk-muted, rgba(0,0,0,0.06))",
              borderRadius: "var(--radius-qk)",
            }}
            aria-hidden="true"
          />
        ))}
      </section>
    );
  }

  if (state.isError) {
    return (
      <section
        className={rootClass}
        role="alert"
        aria-live="assertive"
        style={rootStyle}
      >
        <p className="qk-recommendations-error mb-2">
          Couldn’t load recommendations
          {state.error !== null ? `: ${state.error.message}` : "."}
        </p>
        <button
          type="button"
          className="qk-recommendations-retry focus-visible:outline-2"
          onClick={(): void => {
            void state.refetch();
          }}
          style={{
            background: "var(--color-qk-primary)",
            color: "var(--color-qk-bg)",
            borderRadius: "var(--radius-qk)",
            padding: "0.5rem 1rem",
            border: "none",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </section>
    );
  }

  const data = state.data;
  const ids = data?.missionIds ?? [];

  if (ids.length === 0) {
    return (
      <section
        className={rootClass}
        role="status"
        style={{ ...rootStyle, opacity: 0.8 }}
      >
        <p className="qk-recommendations-empty">
          No recommendations yet — keep playing!
        </p>
      </section>
    );
  }

  const slotIds = ids.slice(0, MAX_RECOMMENDATIONS);

  return (
    <section
      className={rootClass}
      style={rootStyle}
      aria-label="Recommended missions"
      data-cached={data?.cached === true ? "true" : "false"}
    >
      {data?.reason !== undefined && data.reason.length > 0 && (
        <p
          className="qk-recommendations-reason text-sm"
          style={{
            opacity: 0.8,
            margin: 0,
            fontStyle: "italic",
          }}
        >
          {data.reason}
        </p>
      )}
      {data?.cached === true && (
        <p
          className="qk-recommendations-cached-hint text-xs"
          style={{
            opacity: 0.6,
            margin: 0,
          }}
        >
          Refreshes hourly
        </p>
      )}
      {slotIds.map((id) => (
        <RecommendedMissionSlot
          key={id}
          id={id}
          {...(onClaim !== undefined ? { onClaim } : {})}
        />
      ))}
    </section>
  );
}
