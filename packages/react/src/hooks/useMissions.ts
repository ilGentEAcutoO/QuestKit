import type { MissionsListOpts, MissionsListResponse } from "@questkit/core";

import type { MissionProgress, SDKUpdate } from "@questkit/types";
import type { HookState } from "./types";
import { QuestKitError } from "@questkit/core";

/**
 * useMissions — fetch missions + progress and keep `progress` live by
 * folding in `mission.progress` / `mission.completed` / `mission.claimed`
 * SSE updates.
 *
 * SSE is the SOLE source of progress updates (TASK-012 / F3 fix, v0.1.11).
 * The previous v0.1.10 implementation also subscribed to
 * `client.onFireEventSuccess` and applied an optimistic `+1` per acknowledged
 * mission. That created a double-bump on every event: the server-side rule
 * engine evaluates the event and emits `mission.progress` over SSE
 * (monotonic merge via `Math.max`), AND the SDK's POST-response handler
 * fired the optimistic +1 from the same event. When both landed for the
 * same event — the normal happy case — the display advanced by 2 while
 * the server-authoritative count advanced by 1. Eventually the display
 * reached `targetCount` while the server stayed below it, and
 * `POST /v1/missions/:id/claim` returned 409 `claim_not_ready`. The v0.1.9
 * demo toast + refetch made that failure recoverable, but the UX cost was
 * a confusing "Not ready yet" toast on what looked like a complete
 * mission.
 *
 * Dropping the optimistic path makes SSE the single source of truth.
 * Cost: a ~50-200ms delay between the POST returning and the counter
 * visibly updating, since the SSE delivery now has to round-trip through
 * the SSE_HUB Durable Object. This is acceptable because
 * `useMissionClaim` (TASK-001) already refetches on claim success / 409,
 * which catches the only critical path where an SSE drop would matter.
 *
 * The hook intentionally does NOT mutate the `missions` array on SSE —
 * mission definitions don't change at runtime, only their progress does.
 * If a campaign curator updates a mission server-side, the consumer must
 * call `refetch()`.
 *
 * Merge policy (TASK-001 + TASK-012):
 *   - SSE `mission.progress`: monotonic on `currentCount` (Math.max with
 *     prev), authoritative on every other field (`status`, `claimedAt`,
 *     `updatedAt`, `progress`, …). The monotonic guard is now mostly
 *     defensive — without an optimistic path the only scenario it
 *     protects against is out-of-order SSE delivery for back-to-back
 *     events. We keep it because the cost is one `Math.max` per delivery
 *     and the failure mode (a visible counter regression) is jarring.
 *   - SSE `mission.completed`: unconditional overwrite. Completion is a
 *     terminal state and we want it to land immediately.
 *   - SSE `mission.claimed` (Phase 9 / TASK-001 Cluster C1): unconditional
 *     overwrite. Claim is also terminal — the API emits this AFTER the
 *     D1 commit, so the payload IS the authoritative post-claim shape
 *     (status: "claimed", updatedAt: claimTimeMs). We route it through
 *     the same branch as `mission.completed` so the MissionCard's
 *     status-driven button state flips immediately.
 *
 * Observability (TASK-012):
 *   The SSE handler emits a `console.debug("[questkit:mission] SSE update", …)`
 *   on every accepted delivery. Use Chrome DevTools' "Verbose" log level
 *   to see it; default filters hide debug-level logs so this is invisible
 *   in production unless explicitly enabled.
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
        update.type !== "mission.completed" &&
        update.type !== "mission.claimed"
      ) {
        return;
      }
      if (!isMountedRef.current) return;
      const p = update.data;
      setData((prev) => {
        if (prev === undefined) return prev;
        const existing = prev.progress[p.missionId];
        // TASK-012 — observability: log once per accepted SSE delivery, BEFORE
        // the merge runs, so the log line fires regardless of whether the
        // merge produced a visible change. `console.debug` is hidden by the
        // default DevTools filter so this stays invisible in normal browsing;
        // devs flip Verbose level on to see it. ESLint's `no-console` rule
        // only allows `warn` / `error`, but this is a deliberate
        // browser-side observability hook — see CHANGELOG v0.1.11.
        // eslint-disable-next-line no-console
        if (typeof console !== "undefined" && console.debug !== undefined) {
          // eslint-disable-next-line no-console
          console.debug("[questkit:mission] SSE update", {
            missionId: p.missionId,
            type: update.type,
            before: existing?.currentCount,
            after: p.currentCount,
          });
        }
        // Terminal events (mission.completed / mission.claimed) are
        // unconditional overwrites so the new terminal state lands
        // immediately — even if the count would briefly lower (shouldn't
        // happen server-side, but we never block a terminal transition).
        // For mission.claimed the server has already committed the D1
        // transition, so the payload IS the source of truth.
        if (
          update.type === "mission.completed" ||
          update.type === "mission.claimed" ||
          existing === undefined
        ) {
          return {
            ...prev,
            progress: { ...prev.progress, [p.missionId]: p },
          };
        }
        // mission.progress: monotonic on currentCount as a defensive guard
        // against out-of-order SSE delivery for back-to-back events. Every
        // other field is authoritative — server is the source of truth for
        // status / claimedAt / updatedAt / etc.
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
