/**
 * <MissionList /> — fetches a page of missions and renders one MissionCard each.
 *
 * Owns the `useMissions` subscription so the SSE-fed progress updates flow
 * through a single source of truth; individual cards are presentational.
 *
 * The plan text says "virtualized if > 50". For v0.1 we don't add a
 * virtualization dep (no package in the lockfile, and pulling react-window
 * would bloat the bundle for a feature most demos don't need). Instead we
 * slice to the first 50 results and surface a "Load more" stub that
 * (today) just expands the local cap — when TASK-017 wires the SDK
 * `nextCursor` for true pagination, this is the integration point.
 *
 * States rendered:
 *   - loading: `role="status"` + visible skeleton
 *   - error:   `role="alert"` with a retry button
 *   - empty:   neutral copy
 *   - loaded:  list of cards
 */
import type { MissionsListOpts } from "@questkit/core";
import type { ReactElement } from "react";
import { useCallback, useState } from "react";

import { useMissions } from "../../hooks/useMissions";
import { MissionCard } from "../MissionCard";

const MAX_DEFAULT = 50;

export interface MissionListProps {
  /** Forwarded to `useMissions`. */
  campaignId?: string;
  /** Mirror the brief signature; ultimately overrides MAX_DEFAULT. */
  limit?: number;
  /** Status filter, forwarded to `useMissions`. */
  status?: "active" | "completed" | "claimed" | "locked" | "all";
  /**
   * Claim handler forwarded to each MissionCard. The list itself does not
   * own the mutation — see MissionCard's docstring.
   */
  onClaim?: (missionId: string) => Promise<void>;
  className?: string;
}

export function MissionList({
  campaignId,
  limit,
  status,
  onClaim,
  className,
}: MissionListProps): ReactElement {
  // Track the local "page size" — Load More increases this without
  // refetching. Once the cursor-based fetcher arrives this will instead
  // call refetch with the next cursor.
  const [showCount, setShowCount] = useState<number>(limit ?? MAX_DEFAULT);

  // Build hook opts conditionally to honour exactOptionalPropertyTypes.
  const opts: MissionsListOpts = {};
  if (campaignId !== undefined) opts.campaignId = campaignId;
  if (status !== undefined) opts.status = status;
  if (limit !== undefined) opts.limit = limit;

  const state = useMissions(opts);

  // Wrap the caller's onClaim to also trigger a self-refetch after the
  // promise resolves. The wire-up exists because the API's claim broadcast
  // (mission.claimed via SSE) is best-effort + waitUntil-detached — if
  // the SSE_HUB DO is wedged the event silently drops and the card would
  // stay at "Claim" forever. Refetching after the API returns guarantees
  // the card flips to "Claimed" regardless of SSE health. Phase 9 /
  // TASK-001 Cluster C1 (bug B1).
  const wrappedOnClaim = useCallback(
    async (missionId: string): Promise<void> => {
      if (onClaim === undefined) return;
      try {
        await onClaim(missionId);
      } finally {
        // Failures inside refetch are non-fatal — the claim already
        // succeeded server-side; a stale card is preferable to a thrown
        // exception in the host's render tree.
        try {
          await state.refetch();
        } catch {
          // ignore — host's `useMissions().error` slot surfaces it.
        }
      }
    },
    [onClaim, state],
  );

  const rootClass = ["qk-mission-list", "flex flex-col gap-3", className]
    .filter(Boolean)
    .join(" ");

  if (state.isLoading) {
    return (
      <div
        className={rootClass}
        role="status"
        aria-busy="true"
        aria-label="Loading missions"
      >
        {/* Three lightweight skeletons — enough cue without flashy noise. */}
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="qk-mission-list-skeleton h-24"
            style={{
              background: "var(--color-qk-muted, rgba(0,0,0,0.06))",
              borderRadius: "var(--radius-qk)",
            }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (state.isError) {
    return (
      <div
        className={rootClass}
        role="alert"
        aria-live="assertive"
        style={{
          background: "var(--color-qk-bg)",
          color: "var(--color-qk-fg)",
          padding: "1rem",
          borderRadius: "var(--radius-qk)",
        }}
      >
        <p className="qk-mission-list-error mb-2">
          Couldn’t load missions
          {state.error !== null ? `: ${state.error.message}` : "."}
        </p>
        <button
          type="button"
          className="qk-mission-list-retry focus-visible:outline-2"
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
      </div>
    );
  }

  const missions = state.data?.missions ?? [];
  const progress = state.data?.progress ?? {};

  if (missions.length === 0) {
    return (
      <div
        className={rootClass}
        role="status"
        style={{
          padding: "1rem",
          background: "var(--color-qk-bg)",
          color: "var(--color-qk-fg)",
          borderRadius: "var(--radius-qk)",
          opacity: 0.8,
        }}
      >
        No missions yet.
      </div>
    );
  }

  const cap = showCount;
  const visible = missions.slice(0, cap);
  const hasMore = missions.length > cap;

  return (
    <div className={rootClass} data-mission-count={missions.length}>
      {visible.map((m) => {
        const p = progress[m.id];
        return (
          <MissionCard
            key={m.id}
            mission={m}
            progress={p ?? undefined}
            {...(onClaim !== undefined ? { onClaim: wrappedOnClaim } : {})}
          />
        );
      })}
      {hasMore && (
        <button
          type="button"
          className="qk-mission-list-loadmore self-center mt-2 focus-visible:outline-2"
          onClick={(): void => {
            // Stub: today we just lift the local cap by 50. Once the SDK
            // supports cursor pagination this calls `refetch` with the
            // next cursor and appends the new page.
            setShowCount((n) => n + MAX_DEFAULT);
          }}
          style={{
            background: "var(--color-qk-bg)",
            color: "var(--color-qk-primary)",
            border: "1px solid var(--color-qk-primary)",
            borderRadius: "var(--radius-qk)",
            padding: "0.5rem 1rem",
            fontWeight: 600,
            cursor: "pointer",
          }}
          aria-label={`Load more missions (${missions.length - cap} hidden)`}
        >
          Load more
        </button>
      )}
    </div>
  );
}
