/**
 * useRecommendations — AI-powered mission recommendations (TASK-017).
 *
 * Returns the same `HookState<T>` shape as the other hooks for visual /
 * structural consistency. Two caching layers are involved:
 *
 *   - Server (KV, 1h)   — managed by /v1/recommendations + services/ai.ts.
 *     The `cached: true` flag on the response surfaces a server cache hit.
 *
 *   - Client (this hook, 5 min, in-memory) — module-level `Map<userId,
 *     CacheEntry>` so multiple mounts of `<RecommendedMissions>` in the
 *     same React tree don't hammer the endpoint. Per-userId scope avoids
 *     cross-user mixups in multi-user host apps.
 *     Fallback responses (`fallback: true`) are NEVER written to this cache
 *     — the server skips KV cache for fallbacks so the next call retries the
 *     AI, and caching them client-side would defeat that retry path.
 *
 * SSE invalidation: when the server emits an `SDKUpdate` of type
 * `recommendation`, we invalidate the matching userId's cache entry so the
 * next mount refetches. We do NOT actively rewrite the current hook's
 * `data` from the SSE payload because the SSE message doesn't carry
 * `cached`/`count` fields — the cleanest contract is "invalidate, refetch
 * on next mount".
 *
 * Why module-level cache (not React context)?
 *   - Mount/unmount of `<RecommendedMissions>` shouldn't reset the cache.
 *   - The cache outlives a single tree subscription.
 *   - The `__clearRecommendationsCacheForTests` export gives tests a clean
 *     reset between describe blocks.
 */
import type { RecommendationsResult } from "@questkit/core";
import type { SDKUpdate } from "@questkit/types";

import type { HookState } from "./types";

import { QuestKitError } from "@questkit/core";
import { useCallback, useEffect, useRef, useState } from "react";

import { useQuestKit } from "../provider";

/** Client-side cache TTL — 5 minutes (the brief). */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: RecommendationsResult;
  expiresAt: number;
}

/** Module-level cache. Keyed by userId. */
const recommendationsCache: Map<string, CacheEntry> = new Map();

/**
 * Test-only escape hatch. Calling this from a `beforeEach` lets tests start
 * each spec with an empty cache. Not part of the public surface — the name
 * starts with `__` and is documented as "for tests only".
 */
export function __clearRecommendationsCacheForTests(): void {
  recommendationsCache.clear();
}

function readCache(userId: string): RecommendationsResult | null {
  const entry = recommendationsCache.get(userId);
  if (entry === undefined) return null;
  if (entry.expiresAt < Date.now()) {
    recommendationsCache.delete(userId);
    return null;
  }
  return entry.data;
}

function writeCache(userId: string, data: RecommendationsResult): void {
  recommendationsCache.set(userId, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function invalidateCache(userId: string): void {
  recommendationsCache.delete(userId);
}

export function useRecommendations(): HookState<RecommendationsResult> {
  const client = useQuestKit();
  const [data, setData] = useState<RecommendationsResult | undefined>(
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

  /**
   * Core fetch function. `bypassCache` is set by refetch() so the consumer
   * can force a re-roll without waiting for the 5-minute TTL.
   */
  const doFetch = useCallback(
    async (bypassCache: boolean): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const userId = await client.getUserId();
        if (!isMountedRef.current) return;

        // Cache check (skipped on bypass).
        if (!bypassCache) {
          const cached = readCache(userId);
          if (cached !== null) {
            setData(cached);
            setIsLoading(false);
            return;
          }
        }

        // Cache MISS or bypass — go to the server.
        const next = await client.getRecommendations();
        if (!isMountedRef.current) return;
        // Do NOT cache fallback responses — the server intentionally skips KV
        // cache on fallback so the next call retries the AI. Caching here for
        // 5 minutes would defeat that and trap users on a stale empty-state
        // long after the AI is back up.
        if (next.fallback !== true) {
          writeCache(userId, next);
        }
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
    },
    [client],
  );

  const refetch = useCallback((): Promise<void> => {
    return doFetch(true);
  }, [doFetch]);

  useEffect(() => {
    void doFetch(false);
  }, [doFetch]);

  // SSE — invalidate cache on `recommendation` updates so the next mount
  // refetches. We don't actively update `data` here because the SSE payload
  // doesn't carry `cached`/`count` (different shape from the route response);
  // invalidate + lazy refetch keeps the response shape consistent.
  useEffect(() => {
    const unsub = client.subscribe((update: SDKUpdate) => {
      if (update.type !== "recommendation") return;
      invalidateCache(update.data.userId);
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
    refetch,
  };
}
