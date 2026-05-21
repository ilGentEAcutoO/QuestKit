/**
 * useMissionClaim — shared MissionList/MissionCard onClaim handler.
 *
 * Calls client.claimMission(missionId) and surfaces the resulting reward
 * via the demo's toast host. Errors are swallowed with a console warn —
 * the MissionCard's own "Claiming…" state resolves via its finally
 * block, and the SDK's claim error path lands in EventLog via the
 * normal SDK error channel.
 *
 * Extracted because three demo routes (ecommerce, streaming, daily) all
 * render the same MissionList/MissionCard surface and would otherwise
 * each have to duplicate the wiring. The original demo build forgot to
 * wire onClaim entirely, so the Claim button fired its analytics ping
 * but never POSTed /v1/missions/:id/claim. Surfaced by the live
 * click-through PDCA sweep.
 *
 * Refetch fallback (Phase 9 / TASK-001 Cluster C1):
 *   The API broadcasts `mission.claimed` + `reward.granted` (+ optional
 *   `balance.changed`) over SSE after a successful claim, and the SDK's
 *   `useMissions` listener flips `progress[id].status` to "claimed" so
 *   the card disables. BUT: that broadcast is best-effort and detached
 *   via `waitUntil`, so a wedged SSE_HUB DO can silently drop all three
 *   events. The user EXPLICITLY requested a belt-and-suspenders refetch
 *   here so the UI always converges after a 200 from the claim API —
 *   without it, bug B1 returns the moment SSE is degraded. Routes pass
 *   `onClaimed` wired to their `useMissions().refetch`.
 */
import type { Reward } from "@questkit/types";
import { QuestKitError } from "@questkit/core";
import { useQuestKit } from "@questkit/react";
import { useCallback } from "react";

import { useDemoToast } from "../components/DemoToastHost";

export interface UseMissionClaimOpts {
  /**
   * Called after a successful `client.claimMission` resolves. Routes wire
   * this to `useMissions().refetch` so the MissionCard converges to
   * `status === "claimed"` even when SSE drops the `mission.claimed`
   * event (best-effort + `waitUntil`-detached on the API side).
   *
   * Failures inside `onClaimed` are swallowed so they never block the
   * toast — the refetch is a backstop, not the primary signal path.
   */
  onClaimed?: () => void | Promise<void>;
}

export function useMissionClaim(
  opts: UseMissionClaimOpts = {},
): (missionId: string) => Promise<void> {
  const client = useQuestKit();
  const { show: showToast } = useDemoToast();
  const { onClaimed } = opts;
  return useCallback(
    async (missionId: string): Promise<void> => {
      try {
        const result = await client.claimMission(missionId);
        // Reward toast first — the card has already flipped to disabled
        // via the SSE `mission.claimed` event in the healthy path. The
        // refetch fallback below runs in parallel for the SSE-degraded
        // path so the card converges even when no event lands.
        showToast(result.reward as Reward);
        // Fire-and-forget refetch — never block the user on it, never let
        // its error surface (the claim already succeeded, the toast
        // already rendered, the refetch is purely defensive).
        if (onClaimed !== undefined) {
          try {
            await onClaimed();
          } catch (err) {
            console.warn("[demo] onClaimed refetch failed", err);
          }
        }
      } catch (err) {
        console.warn("[demo] claimMission failed", err);
        // F1 hotfix (v0.1.9): surface the silent 409 "claim_not_ready" path —
        // previously this branch only console.warn'd, leaving the user with
        // no feedback when the optimistic counter overshot the server's
        // authoritative progress (root cause was the KV idempotency replay
        // asymmetry, fixed worker-side; this is the demo's belt-and-
        // suspenders so any future regression can't silently swallow a 409).
        const is409NotReady =
          err instanceof QuestKitError &&
          (err.status === 409 || err.code === "claim_not_ready");
        if (is409NotReady) {
          showToast({
            kind: "error",
            title: "Not ready yet",
            description:
              "This mission isn't complete on the server yet. Refreshing…",
          });
          // Always refetch on 409 — the optimistic counter was wrong, so the
          // UI MUST converge back to authoritative state before the user
          // tries again. Failures here are swallowed (same policy as the
          // success path) so they never block the toast.
          if (onClaimed !== undefined) {
            try {
              await onClaimed();
            } catch (refetchErr) {
              console.warn("[demo] post-409 refetch failed", refetchErr);
            }
          }
        }
      }
    },
    [client, showToast, onClaimed],
  );
}
