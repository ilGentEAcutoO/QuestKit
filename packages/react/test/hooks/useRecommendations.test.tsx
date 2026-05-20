import type { RecommendationsResult } from "@questkit/core";
import type { SDKUpdate } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";

import { QuestKitError } from "@questkit/core";
/**
 * useRecommendations — TDD specs (TASK-017).
 *
 * Behaviour:
 *   1. Loading state initially.
 *   2. Resolves with { missionIds, reason, cached, count } from
 *      client.getRecommendations().
 *   3. Errors surface via `error`.
 *   4. Module-level 5-minute in-memory cache: a SECOND renderHook with the
 *      same userId returns synchronously (no isLoading flash) AND does NOT
 *      re-invoke getRecommendations.
 *   5. SSE update of type `recommendation` invalidates the cache so the
 *      NEXT mount refetches.
 *   6. Different userIds get different cache entries (no cross-user mix).
 */
import { act, renderHook, waitFor } from "@testing-library/react";

import {
  __clearRecommendationsCacheForTests,
  useRecommendations,
} from "../../src/hooks/useRecommendations";
import { QuestKitProvider } from "../../src/provider";
import { type FakeClient, makeFakeClient } from "./test-utils";

function wrapperWith(
  client: FakeClient,
): (props: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QuestKitProvider
        client={
          client as unknown as Parameters<typeof QuestKitProvider>[0]["client"]
        }
      >
        {children}
      </QuestKitProvider>
    );
  };
}

const sampleRecs: RecommendationsResult = {
  missionIds: ["m1", "m2"],
  reason: "You’ve been on a streak — keep going!",
  cached: false,
  count: 2,
};

beforeEach(() => {
  __clearRecommendationsCacheForTests();
});

describe("useRecommendations", () => {
  it("returns loading state on first render", () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockReturnValue(new Promise(() => {})),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const { result } = renderHook(() => useRecommendations(), {
      wrapper: wrapperWith(client),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("populates data after fetch resolves", async () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue(sampleRecs),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const { result } = renderHook(() => useRecommendations(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sampleRecs);
    expect(result.current.error).toBeNull();
  });

  it("records errors", async () => {
    const boom = new QuestKitError("ai_unavailable", "server_error", 503);
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockRejectedValue(boom),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const { result } = renderHook(() => useRecommendations(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
  });

  it("wraps non-QuestKitError throws into a network_error QuestKitError", async () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockRejectedValue(new Error("boom")),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const { result } = renderHook(() => useRecommendations(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(QuestKitError);
    expect(result.current.error?.code).toBe("network_error");
  });

  it("serves the second renderHook from the in-memory cache (no second getRecommendations call)", async () => {
    const getRecs = jest.fn().mockResolvedValue(sampleRecs);
    const client = makeFakeClient({
      getRecommendations: getRecs,
      getUserId: jest.fn().mockResolvedValue("u1"),
    });

    const wrapper = wrapperWith(client);
    const r1 = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(r1.result.current.isSuccess).toBe(true));
    expect(getRecs).toHaveBeenCalledTimes(1);

    // Second mount with the same userId → cache HIT, no refetch.
    const r2 = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(r2.result.current.isSuccess).toBe(true));
    expect(r2.result.current.data).toEqual(sampleRecs);
    expect(getRecs).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache fallback responses — next mount retries the server (Phase 8 TASK-002 follow-up)", async () => {
    // The server intentionally bypasses KV cache for fallback responses so the
    // next call retries the AI. The hook MUST mirror that: writing the
    // fallback into its 5-minute in-memory cache would trap users on a stale
    // empty-state long after the AI recovers. See useRecommendations.ts.
    const fallbackRecs: RecommendationsResult = {
      missionIds: [],
      reason: "AI picks unavailable right now.",
      cached: false,
      count: 0,
      fallback: true,
    };
    const successRecs: RecommendationsResult = {
      ...sampleRecs,
      missionIds: ["m1", "m2"],
      count: 2,
    };
    const getRecs = jest
      .fn()
      .mockResolvedValueOnce(fallbackRecs)
      .mockResolvedValueOnce(successRecs)
      .mockResolvedValueOnce(successRecs);
    const client = makeFakeClient({
      getRecommendations: getRecs,
      getUserId: jest.fn().mockResolvedValue("u1"),
    });

    const wrapper = wrapperWith(client);

    // First mount — receives fallback.
    const r1 = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(r1.result.current.isSuccess).toBe(true));
    expect(r1.result.current.data).toEqual(fallbackRecs);
    expect(getRecs).toHaveBeenCalledTimes(1);

    // Second mount — fallback was NOT cached, so the hook MUST refetch (cache
    // miss). This time the AI is back and we get a real recommendation.
    const r2 = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(r2.result.current.isSuccess).toBe(true));
    expect(r2.result.current.data).toEqual(successRecs);
    expect(getRecs).toHaveBeenCalledTimes(2);

    // Third mount — happy-path result IS cached, so no further client call.
    const r3 = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(r3.result.current.isSuccess).toBe(true));
    expect(r3.result.current.data).toEqual(successRecs);
    expect(getRecs).toHaveBeenCalledTimes(2);
  });

  it("does NOT mix data across userIds (cache is per-user)", async () => {
    const recsForU1: RecommendationsResult = {
      ...sampleRecs,
      missionIds: ["a"],
      count: 1,
    };
    const recsForU2: RecommendationsResult = {
      ...sampleRecs,
      missionIds: ["b"],
      count: 1,
    };

    // First user — primes the cache.
    const c1 = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue(recsForU1),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const r1 = renderHook(() => useRecommendations(), {
      wrapper: wrapperWith(c1),
    });
    await waitFor(() => expect(r1.result.current.isSuccess).toBe(true));
    expect(r1.result.current.data?.missionIds).toEqual(["a"]);

    // Second user — fetches independently because the cache key is userId-scoped.
    const getRecsU2 = jest.fn().mockResolvedValue(recsForU2);
    const c2 = makeFakeClient({
      getRecommendations: getRecsU2,
      getUserId: jest.fn().mockResolvedValue("u2"),
    });
    const r2 = renderHook(() => useRecommendations(), {
      wrapper: wrapperWith(c2),
    });
    await waitFor(() => expect(r2.result.current.isSuccess).toBe(true));
    expect(r2.result.current.data?.missionIds).toEqual(["b"]);
    expect(getRecsU2).toHaveBeenCalledTimes(1);
  });

  it("invalidates the cache on a `recommendation` SSE update so the next mount refetches", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const getRecs = jest
      .fn()
      .mockResolvedValueOnce(sampleRecs)
      .mockResolvedValueOnce({ ...sampleRecs, missionIds: ["m3"], count: 1 });
    const client = makeFakeClient({
      getRecommendations: getRecs,
      getUserId: jest.fn().mockResolvedValue("u1"),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });

    const wrapper = wrapperWith(client);
    const r1 = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(r1.result.current.isSuccess).toBe(true));
    expect(getRecs).toHaveBeenCalledTimes(1);

    // Push a recommendation update — this should invalidate the cache.
    act(() => {
      push?.({
        type: "recommendation",
        data: { userId: "u1", missionIds: ["m3"], reason: "fresh!" },
      });
    });

    // Second mount AFTER the SSE — should refetch.
    const r2 = renderHook(() => useRecommendations(), { wrapper });
    await waitFor(() => expect(r2.result.current.isSuccess).toBe(true));
    expect(getRecs).toHaveBeenCalledTimes(2);
    expect(r2.result.current.data?.missionIds).toEqual(["m3"]);
  });

  it("refetch() bypasses the cache and re-invokes getRecommendations", async () => {
    const updated: RecommendationsResult = {
      ...sampleRecs,
      missionIds: ["m9"],
      count: 1,
    };
    const getRecs = jest
      .fn()
      .mockResolvedValueOnce(sampleRecs)
      .mockResolvedValueOnce(updated);
    const client = makeFakeClient({
      getRecommendations: getRecs,
      getUserId: jest.fn().mockResolvedValue("u1"),
    });

    const { result } = renderHook(() => useRecommendations(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(sampleRecs);

    await act(async () => {
      await result.current.refetch();
    });
    expect(getRecs).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual(updated);
  });
});
