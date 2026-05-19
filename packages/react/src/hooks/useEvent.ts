import type { FireEventInput, FireEventResult } from "@questkit/core";

import { QuestKitError } from "@questkit/core";
/**
 * useEvent — write-only hook for firing analytics events.
 *
 * Differs from the other hooks: no data field, no SSE subscription. The
 * exposed surface is an imperative `fireEvent` action, a transient
 * `isFiring` flag, and an `error` slot that captures the most recent
 * failure. The host normally calls `fireEvent` from a button click handler
 * and doesn't care about reactive state — but `isFiring` is useful for
 * disabling the trigger UI during inflight requests.
 *
 * `fireEvent` returns a Promise that rejects on failure so the caller can
 * still await + branch on the outcome. `error` is set as a side effect so
 * UIs can display the most recent failure without keeping a try/catch.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useQuestKit } from "../provider";

export interface UseEventResult {
  fireEvent: (input: FireEventInput) => Promise<FireEventResult>;
  isFiring: boolean;
  error: QuestKitError | null;
}

export function useEvent(): UseEventResult {
  const client = useQuestKit();
  const [isFiring, setIsFiring] = useState<boolean>(false);
  const [error, setError] = useState<QuestKitError | null>(null);

  const isMountedRef = useRef<boolean>(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fireEvent = useCallback(
    async (input: FireEventInput): Promise<FireEventResult> => {
      if (isMountedRef.current) {
        setIsFiring(true);
        setError(null);
      }
      try {
        const result = await client.fireEvent(input);
        if (isMountedRef.current) setIsFiring(false);
        return result;
      } catch (err) {
        const e =
          err instanceof QuestKitError
            ? err
            : new QuestKitError(
                err instanceof Error ? err.message : String(err),
                "network_error",
              );
        if (isMountedRef.current) {
          setError(e);
          setIsFiring(false);
        }
        throw e;
      }
    },
    [client],
  );

  return { fireEvent, isFiring, error };
}
