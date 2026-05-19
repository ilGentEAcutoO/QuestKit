import type { Mission, MissionProgress, SDKUpdate } from "@questkit/types";

import type { HookState } from "./types";
import { QuestKitError } from "@questkit/core";

/**
 * useMission — fetch a single mission + its progress, then keep the progress
 * live via SSE updates filtered by missionId.
 *
 * If `getMission()` returns `null` for progress (server has no record yet
 * for the user), an incoming `mission.progress` update still populates the
 * field — i.e. the first progress event is treated as creating the row.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuestKit } from "../provider";

export interface UseMissionData {
  mission: Mission;
  progress: MissionProgress | null;
}

export function useMission(id: string): HookState<UseMissionData> {
  const client = useQuestKit();
  const [data, setData] = useState<UseMissionData | undefined>(undefined);
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
      const next = await client.getMission(id);
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

  useEffect(() => {
    const unsub = client.subscribe((update: SDKUpdate) => {
      if (
        update.type !== "mission.progress" &&
        update.type !== "mission.completed"
      ) {
        return;
      }
      if (update.data.missionId !== id) return;
      if (!isMountedRef.current) return;
      setData((prev) => {
        if (prev === undefined) return prev;
        return { ...prev, progress: update.data };
      });
    });
    return unsub;
  }, [client, id]);

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
