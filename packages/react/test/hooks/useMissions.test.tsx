import type { Mission, MissionProgress, SDKUpdate } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";

import { QuestKitError } from "@questkit/core";
/**
 * useMissions — TDD specs.
 *
 * Behaviour:
 *   1. Loading state initially.
 *   2. Resolves with { missions, progress, nextCursor? } from getMissions.
 *   3. mission.progress SSE updates patch `data.progress[missionId]`.
 *   4. mission.completed SSE updates also patch the same map.
 *   5. Other update types are ignored.
 *   6. Unmount unsubscribes.
 *   7. Errors surface via `error`.
 *   8. opts are forwarded to client.getMissions().
 *   9. refetch() re-fetches.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

import { useMissions } from "../../src/hooks/useMissions";
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

const mission1: Mission = {
  id: "m1",
  title: "Click 5 times",
  description: "click",
  criteria: { eventName: "click", count: 5 },
  reward: { kind: "currency", currency: "GOLD", amount: 10 },
};

const progress1: MissionProgress = {
  userId: "u1",
  missionId: "m1",
  status: "active",
  progress: 0.2,
  currentCount: 1,
  targetCount: 5,
  updatedAt: 1,
};

describe("useMissions", () => {
  it("returns loading state on first render", () => {
    const client = makeFakeClient({
      getMissions: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("populates data after fetch resolves", async () => {
    const response = {
      missions: [mission1],
      progress: { m1: progress1 },
    };
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue(response),
    });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(response);
    expect(result.current.error).toBeNull();
  });

  it("forwards opts to client.getMissions", async () => {
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue({ missions: [], progress: {} }),
    });
    const opts = { campaignId: "c1", limit: 10 };
    renderHook(() => useMissions(opts), { wrapper: wrapperWith(client) });
    await waitFor(() => expect(client.getMissions).toHaveBeenCalledWith(opts));
  });

  it("records errors", async () => {
    const boom = new QuestKitError("nope", "server_error", 500);
    const client = makeFakeClient({
      getMissions: jest.fn().mockRejectedValue(boom),
    });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
    expect(result.current.data).toBeUndefined();
  });

  it("patches progress on mission.progress SSE", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const response = {
      missions: [mission1],
      progress: { m1: progress1 },
    };
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue(response),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const next: MissionProgress = {
      ...progress1,
      currentCount: 3,
      progress: 0.6,
    };
    act(() => {
      push?.({ type: "mission.progress", data: next });
    });
    expect(result.current.data?.progress.m1).toEqual(next);
  });

  it("patches progress on mission.completed SSE", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getMissions: jest
        .fn()
        .mockResolvedValue({
          missions: [mission1],
          progress: { m1: progress1 },
        }),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const done: MissionProgress = {
      ...progress1,
      status: "completed",
      currentCount: 5,
      progress: 1,
    };
    act(() => {
      push?.({ type: "mission.completed", data: done });
    });
    expect(result.current.data?.progress.m1).toEqual(done);
  });

  it("ignores non-mission updates", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const response = {
      missions: [mission1],
      progress: { m1: progress1 },
    };
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue(response),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    act(() => {
      push?.({
        type: "balance.changed",
        data: {
          userId: "u1",
          currency: "GOLD",
          amount: 1,
          updatedAt: 1,
        },
      });
    });
    expect(result.current.data?.progress).toEqual({ m1: progress1 });
  });

  it("calls unsubscribe on unmount", async () => {
    const unsub = jest.fn();
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue({ missions: [], progress: {} }),
      subscribe: jest.fn().mockReturnValue(unsub),
    });
    const { unmount, result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("wraps non-QuestKitError throws into a network_error QuestKitError", async () => {
    const client = makeFakeClient({
      getMissions: jest.fn().mockRejectedValue(new Error("xx")),
    });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(QuestKitError);
    expect(result.current.error?.code).toBe("network_error");
  });

  it("refetch re-invokes getMissions", async () => {
    const r1 = { missions: [], progress: {} };
    const r2 = { missions: [mission1], progress: { m1: progress1 } };
    const getMissions = jest
      .fn()
      .mockResolvedValueOnce(r1)
      .mockResolvedValueOnce(r2);
    const client = makeFakeClient({ getMissions });
    const { result } = renderHook(() => useMissions(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.data).toEqual(r1));
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual(r2);
    expect(getMissions).toHaveBeenCalledTimes(2);
  });
});
