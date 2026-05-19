import type { Balance, SDKUpdate } from "@questkit/types";

import type { HookState } from "./types";
import { QuestKitError } from "@questkit/core";

/**
 * useBalance — fetch the user's balance for one currency (or all currencies
 * when no arg is given) and keep it live by subscribing to `balance.changed`
 * SSE updates.
 *
 * Returns the standard `HookState<T>`. `T` is `Balance | null` when a
 * currency is specified (null when the server has no row for that
 * currency), or `Balance[]` when no currency is specified.
 *
 *   useBalance("GOLD")  → HookState<Balance | null>
 *   useBalance()        → HookState<Balance[]>
 *
 * The split-return type is annotated via two function overloads so callers
 * who pass a currency don't have to narrow the array branch away.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuestKit } from "../provider";

export function useBalance(currency: string): HookState<Balance | null>;
export function useBalance(): HookState<Balance[]>;
export function useBalance(
  currency?: string,
): HookState<Balance | null> | HookState<Balance[]> {
  const client = useQuestKit();
  const [data, setData] = useState<Balance | null | Balance[] | undefined>(
    undefined,
  );
  const [error, setError] = useState<QuestKitError | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // `isMounted` guards against `setState after unmount` warnings when the
  // fetch resolves after the consumer's component has gone away.
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
      const next =
        currency === undefined
          ? await client.getBalances()
          : await client.getBalance(currency);
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
  }, [client, currency]);

  // Initial fetch + refetch on currency change.
  useEffect(() => {
    void fetchOnce();
  }, [fetchOnce]);

  // SSE subscription. We narrow updates to `balance.changed` and (when a
  // currency is set) filter by the currency code.
  useEffect(() => {
    const unsubscribe = client.subscribe((update: SDKUpdate) => {
      if (update.type !== "balance.changed") return;
      if (!isMountedRef.current) return;
      if (currency === undefined) {
        // List mode: upsert by currency code.
        setData((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const i = list.findIndex((b) => b.currency === update.data.currency);
          if (i === -1) return [...list, update.data];
          const copy = list.slice();
          copy[i] = update.data;
          return copy;
        });
        return;
      }
      if (update.data.currency !== currency) return;
      setData(update.data);
    });
    return unsubscribe;
  }, [client, currency]);

  const isError = error !== null;
  const isSuccess = !isLoading && !isError;

  return {
    data: data as Balance | null | Balance[] | undefined,
    error,
    isLoading,
    isError,
    isSuccess,
    refetch: fetchOnce,
  } as HookState<Balance | null> & HookState<Balance[]>;
}
