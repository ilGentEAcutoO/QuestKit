import type { MissionsListOpts, MissionsListResponse } from "@questkit/core";

import type { SDKUpdate } from "@questkit/types";
import type { HookState } from "./types";
import { QuestKitError } from "@questkit/core";

/**
 * useMissions — fetch missions + progress and keep `progress` live by
 * folding in `mission.progress` / `mission.completed` SSE updates.
 *
 * The hook intentionally does NOT mutate the `missions` array on SSE —
 * mission definitions don't change at runtime, only their progress does.
 * If a campaign curator updates a mission server-side, the consumer must
 * call `refetch()`.
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
        return {
          ...prev,
          progress: { ...prev.progress, [p.missionId]: p },
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
