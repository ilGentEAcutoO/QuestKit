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
 */
import { useQuestKit } from "@questkit/react";
import { useCallback } from "react";

import { useDemoToast } from "../components/DemoToastHost";

export function useMissionClaim(): (missionId: string) => Promise<void> {
  const client = useQuestKit();
  const { show: showToast } = useDemoToast();
  return useCallback(
    async (missionId: string): Promise<void> => {
      try {
        const result = await client.claimMission(missionId);
        showToast(result.reward);
      } catch (err) {
        console.warn("[demo] claimMission failed", err);
      }
    },
    [client, showToast],
  );
}
