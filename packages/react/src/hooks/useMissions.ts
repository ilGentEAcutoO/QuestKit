import type { MissionsListOpts, MissionsListResponse } from "@questkit/core";

import type { MissionProgress, SDKUpdate } from "@questkit/types";
import type { HookState } from "./types";
import { QuestKitError } from "@questkit/core";

/**
 * useMissions — fetch missions + progress and keep `progress` live by
 * folding in `mission.progress` / `mission.completed` SSE updates, plus
 * optimistic `+1` bumps from successful `fireEvent` calls (TASK-006).
 *
 * The hook intentionally does NOT mutate the `missions` array on SSE —
 * mission definitions don't change at runtime, only their progress does.
 * If a campaign curator updates a mission server-side, the consumer must
 * call `refetch()`.
 *
 * Merge policy (TASK-006):
 *   - SSE `mission.progress`: monotonic on `currentCount` (Math.max with
 *     prev), authoritative on every other field (`status`, `claimedAt`,
 *     `updatedAt`, `progress`, …). This prevents a visible counter
 *     regression when the user fires several events back-to-back: the
 *     optimistic state may already be ahead of the first SSE delivery for
 *     event #1, and we must not snap it back to a lower number.
 *   - SSE `mission.completed`: unconditional overwrite. Completion is a
 *     terminal state and we want it to land immediately.
 *   - Optimistic merge (`onFireEventSuccess`): still `currentCount + 1`,
 *     clamped at `targetCount`. The next authoritative SSE / refetch
 *     reconciles via the monotonic rule above (last-writer-wins on
 *     non-count fields, max on count).
 *
 *   This can briefly drift by ±1 if the user fires several events quickly
 *   and the server's `mission.progress` for one of them arrives late, but
 *   the next refetch / completed update will reconcile.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuestKit } from "../provider";

export function useMissions(
  opts: MissionsListOpts = {},
): HookState<MissionsListResponse> {
  const client = useQuestKit();
  const [data, setData] = useState<MissionsListResponse | undefined>(undefined);
  const [error, setError] = useState<QuestKitError | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Serialize opts for the useEffect dep array so we don't refetch on every
  // render when callers inline-create the opts object.
  const optsKey = JSON.stringify(opts);

  const fetchOnce = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const next = await client.getMissions(opts);
      if (!isMountedRef.current) return;
      setData(next);
      setIsLoading(false);
    } catch (err) {
      if (!isMountedRef.current) return;
      const e =
        err instanceof QuestKitError
          ? err
          : new QuestKitError(
              err instanceof Error ? err.message : String(err),
              "network_error",
            );
      setError(e);
      setIsLoading(false);
    }
    // Note: `optsKey` (JSON-serialised) IS the dep for `opts` here, so the
    // exhaustive-deps lint would be wrong if it fired.
  }, [client, optsKey]);

  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    const unsub = client.subscribe((update: SDKUpdate) => {
      if (
        update.type !== "mission.progress" &&
        update.type !== "mission.completed"
      ) {
        return;
      }
      if (!isMountedRef.current) return;
      const p = update.data;
      setData((prev) => {
        if (prev === undefined) return prev;
        const existing = prev.progress[p.missionId];
        // mission.completed is terminal — unconditional overwrite so the
        // completion state lands immediately even if it would lower a count
        // (shouldn't happen server-side, but we never block a completion).
        if (update.type === "mission.completed" || existing === undefined) {
          return {
            ...prev,
            progress: { ...prev.progress, [p.missionId]: p },
          };
        }
        // mission.progress: monotonic on currentCount to prevent a visible
        // regression when optimistic state is already ahead of an in-flight
        // SSE delivery. Every other field is authoritative — server is the
        // source of truth for status / claimedAt / updatedAt / etc.
        const merged: MissionProgress = {
          ...p,
          currentCount: Math.max(existing.currentCount, p.currentCount),
        };
        // Recompute the progress ratio so it matches the (possibly held-up)
        // currentCount rather than the server's lower value.
        if (merged.targetCount > 0) {
          merged.progress = merged.currentCount / merged.targetCount;
        }
        return {
          ...prev,
          progress: { ...prev.progress, [p.missionId]: merged },
        };
      });
    });
    return unsub;
  }, [client]);

  // Optimistic counter updates — TASK-006. See the docblock above for the
  // dedupe policy. Only bumps missions we already know about; unknown IDs
  // are ignored (an unknown ID is probably a mission the host hasn't
  // listed via this hook — e.g. a different campaign).
  useEffect(() => {
    const unsub = client.onFireEventSuccess((missionsUpdated) => {
      if (!isMountedRef.current) return;
      if (missionsUpdated.length === 0) return;
      setData((prev) => {
        if (prev === undefined) return prev;
        let touched = false;
        const nextProgress = { ...prev.progress };
        const now = Date.now();
        for (const id of missionsUpdated) {
          const existing = prev.progress[id];
          if (existing === undefined) continue;
          const nextCount = Math.min(
            existing.currentCount + 1,
            existing.targetCount,
          );
          if (nextCount === existing.currentCount) {
            // Already at target — no change needed, avoid a wasted render.
            continue;
          }
          const reachedTarget = nextCount >= existing.targetCount;
          const updated: MissionProgress = {
            ...existing,
            currentCount: nextCount,
            progress:
              existing.targetCount > 0
                ? nextCount / existing.targetCount
                : existing.progress,
            status:
              reachedTarget && existing.status === "active"
                ? "completed"
                : existing.status,
            // updatedAt is monotonic — guard against existing server-side
            // timestamps being in our future (clock skew).
            updatedAt: Math.max(existing.updatedAt, now),
          };
          nextProgress[id] = updated;
          touched = true;
        }
        if (!touched) return prev;
        return { ...prev, progress: nextProgress };
      });
    });
    return unsub;
  }, [client]);

  const isError = error !== null;
  const isSuccess = !isLoading && !isError;

  return {
    data,
    error,
    isLoading,
    isError,
    isSuccess,
    refetch: fetchOnce,
  };
}
