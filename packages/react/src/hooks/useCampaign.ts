import type { Campaign } from "@questkit/types";

import type { HookState } from "./types";
import { type CampaignDetail, QuestKitError } from "@questkit/core";

/**
 * useCampaign — fetch a single campaign (with optional missions) or the
 * full list of campaigns.
 *
 *   useCampaign("c1") → HookState<CampaignDetail>     (single)
 *   useCampaign()     → HookState<Campaign[]>         (list)
 *
 * No SSE coupling: campaigns are catalog data — they don't mutate at
 * runtime in the normal lifecycle. Consumers can call refetch() if a
 * curator updates a campaign live.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuestKit } from "../provider";

export function useCampaign(id: string): HookState<CampaignDetail>;
export function useCampaign(): HookState<Campaign[]>;
export function useCampaign(
  id?: string,
): HookState<CampaignDetail> | HookState<Campaign[]> {
  const client = useQuestKit();
  const [data, setData] = useState<CampaignDetail | Campaign[] | undefined>(
    undefined,
  );
  const [error, setError] = useState<QuestKitError | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchOnce = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const next: CampaignDetail | Campaign[] =
        id === undefined
          ? await client.getCampaigns()
          : await client.getCampaign(id);
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
  }, [client, id]);

  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  const isError = error !== null;
  const isSuccess = !isLoading && !isError;

  return {
    data: data as CampaignDetail | Campaign[] | undefined,
    error,
    isLoading,
    isError,
    isSuccess,
    refetch: fetchOnce,
  } as HookState<CampaignDetail> & HookState<Campaign[]>;
}
