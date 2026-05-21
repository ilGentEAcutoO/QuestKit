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
      getMissions: jest.fn().mockResolvedValue({
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

  // TASK-001 / Cluster C1 — the claim broadcast event. After POST
  // /v1/missions/:id/claim the API emits `mission.claimed` with the
  // post-claim progress (status: "claimed"). The hook must treat this as
  // terminal — unconditional overwrite — so the MissionCard sees the
  // flipped status and renders the disabled "Claimed" button. Without
  // this handler the card stays at "Claim" forever even though the claim
  // succeeded (this is exactly bug B1 on /ecommerce).
  it("patches progress on mission.claimed SSE", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue({
        missions: [mission1],
        progress: {
          m1: {
            ...progress1,
            status: "completed",
            currentCount: 5,
            progress: 1,
          },
        },
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

    const claimed: MissionProgress = {
      ...progress1,
      status: "claimed",
      currentCount: 5,
      progress: 1,
      updatedAt: 999,
    };
    act(() => {
      push?.({ type: "mission.claimed", data: claimed });
    });
    expect(result.current.data?.progress.m1).toEqual(claimed);
    expect(result.current.data?.progress.m1?.status).toBe("claimed");
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

  // TASK-006 — optimistic counter updates from fireEvent.
  //
  // The hook subscribes to `client.onFireEventSuccess`. When the SDK
  // notifies it that one or more missions advanced server-side, the hook
  // increments `currentCount` locally so the UI keeps moving even when SSE
  // is degraded. Server-side SSE/refetch acts as the authoritative
  // overwrite (last-writer-wins).
  describe("optimistic updates from fireEvent (no SSE)", () => {
    it("increments currentCount when onFireEventSuccess fires for a known mission", async () => {
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const response = {
        missions: [mission1],
        progress: { m1: progress1 },
      };
      const client = makeFakeClient({
        getMissions: jest.fn().mockResolvedValue(response),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Simulate fireEvent success while SSE is silent.
      act(() => {
        pushOptimistic?.(["m1"]);
      });

      const next = result.current.data?.progress.m1;
      expect(next?.currentCount).toBe(progress1.currentCount + 1);
      // progress ratio should reflect the new currentCount / targetCount.
      expect(next?.progress).toBeCloseTo(
        (progress1.currentCount + 1) / progress1.targetCount,
        5,
      );
      // updatedAt should bump forward (optimistic timestamp).
      expect(next?.updatedAt).toBeGreaterThanOrEqual(progress1.updatedAt);
    });

    it("clamps currentCount at targetCount (no overshoot)", async () => {
      const near: MissionProgress = {
        ...progress1,
        currentCount: 4,
        progress: 0.8,
      };
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const client = makeFakeClient({
        getMissions: jest
          .fn()
          .mockResolvedValue({ missions: [mission1], progress: { m1: near } }),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // First bump: 4 → 5 (== target).
      act(() => pushOptimistic?.(["m1"]));
      expect(result.current.data?.progress.m1?.currentCount).toBe(5);

      // Second bump: clamp at 5, do not overshoot.
      act(() => pushOptimistic?.(["m1"]));
      expect(result.current.data?.progress.m1?.currentCount).toBe(5);
    });

    it("handles multiple mission ids in a single callback", async () => {
      const mission2: Mission = { ...mission1, id: "m2" };
      const progress2: MissionProgress = { ...progress1, missionId: "m2" };
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const client = makeFakeClient({
        getMissions: jest.fn().mockResolvedValue({
          missions: [mission1, mission2],
          progress: { m1: progress1, m2: progress2 },
        }),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      act(() => pushOptimistic?.(["m1", "m2"]));

      expect(result.current.data?.progress.m1?.currentCount).toBe(
        progress1.currentCount + 1,
      );
      expect(result.current.data?.progress.m2?.currentCount).toBe(
        progress2.currentCount + 1,
      );
    });

    it("ignores unknown mission ids without throwing", async () => {
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const response = {
        missions: [mission1],
        progress: { m1: progress1 },
      };
      const client = makeFakeClient({
        getMissions: jest.fn().mockResolvedValue(response),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      act(() => pushOptimistic?.(["unknown-mission"]));

      // Existing mission state is untouched.
      expect(result.current.data?.progress.m1).toEqual(progress1);
    });

    // TASK-007 / Cluster C6 — regression for D3 (non-qualifying events).
    //
    // The server-side rule engine (`workers/api/src/rules/index.ts ::
    // evaluateEvent`) only returns missions whose `evaluate()` returned
    // `matched: true` (event name + filter + window + expiry all pass). The
    // `/v1/events` route then forwards `updated.map(p => p.missionId)` as
    // `missionsUpdated` in the response body. The SDK
    // (`packages/core/src/client.ts :: buildSendFn`) takes that array as-is
    // and passes it straight to every `onFireEventSuccess` listener — no
    // local filtering, no fan-out across all active missions.
    //
    // ⇒ The optimistic bump in this hook will NEVER fire for a mission
    //    whose rule predicate didn't match the event. Therefore D3
    //    ("non-qualifying events bump unrelated missions") is a non-bug:
    //    the contract makes it structurally impossible.
    //
    // This test pins that contract: when the SDK reports an update list
    // that excludes mission `m2`, only `m1` advances and `m2` stays at its
    // original count. If a future refactor ever broke that contract (e.g.
    // by fanning out across all known IDs locally), this regression catches
    // it before it ships.
    it("does not bump counter when missionsUpdated does not include the mission", async () => {
      const mission2: Mission = { ...mission1, id: "m2" };
      const progress2: MissionProgress = { ...progress1, missionId: "m2" };
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const client = makeFakeClient({
        getMissions: jest.fn().mockResolvedValue({
          missions: [mission1, mission2],
          progress: { m1: progress1, m2: progress2 },
        }),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Server says: only m1 was affected by this event. m2's rule
      // didn't match, so its ID is absent from the list.
      act(() => pushOptimistic?.(["m1"]));

      // m1 advances by the optimistic +1.
      expect(result.current.data?.progress.m1?.currentCount).toBe(
        progress1.currentCount + 1,
      );
      // m2 must NOT be touched — same currentCount, same updatedAt, same
      // status. Doing an `.toEqual` here would over-match if a future
      // refactor copies fields around; assert the load-bearing fields.
      expect(result.current.data?.progress.m2?.currentCount).toBe(
        progress2.currentCount,
      );
      expect(result.current.data?.progress.m2?.updatedAt).toBe(
        progress2.updatedAt,
      );
      expect(result.current.data?.progress.m2?.status).toBe(progress2.status);
    });

    it("does nothing before initial data has loaded", async () => {
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const client = makeFakeClient({
        // Never resolves — data stays undefined.
        getMissions: jest.fn().mockReturnValue(new Promise(() => {})),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });

      // Fire optimistic update before getMissions resolves — should be a noop.
      expect(() => {
        act(() => pushOptimistic?.(["m1"]));
      }).not.toThrow();
      expect(result.current.data).toBeUndefined();
    });

    it("flips status to completed once currentCount reaches targetCount", async () => {
      const oneAway: MissionProgress = {
        ...progress1,
        currentCount: 4,
        progress: 0.8,
        status: "active",
      };
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const client = makeFakeClient({
        getMissions: jest.fn().mockResolvedValue({
          missions: [mission1],
          progress: { m1: oneAway },
        }),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      act(() => pushOptimistic?.(["m1"]));

      expect(result.current.data?.progress.m1?.currentCount).toBe(5);
      expect(result.current.data?.progress.m1?.status).toBe("completed");
    });

    it("unsubscribes the optimistic listener on unmount", async () => {
      const unsubFireEvent = jest.fn();
      const client = makeFakeClient({
        getMissions: jest
          .fn()
          .mockResolvedValue({ missions: [], progress: {} }),
        onFireEventSuccess: jest.fn().mockReturnValue(unsubFireEvent),
      });
      const { unmount, result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      unmount();
      expect(unsubFireEvent).toHaveBeenCalledTimes(1);
    });

    // Regression: when optimistic state has advanced past an in-flight SSE
    // delivery, the SSE merge MUST be monotonic on currentCount or the user
    // sees the counter snap backwards (e.g. 3 → 2 → 3). See the merge
    // policy docblock at the top of useMissions.ts.
    it("does not let mission.progress SSE lower currentCount below optimistic state (monotonic merge)", async () => {
      const zero: MissionProgress = {
        ...progress1,
        currentCount: 0,
        progress: 0,
      };
      let pushSse: ((u: SDKUpdate) => void) | null = null;
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const client = makeFakeClient({
        getMissions: jest
          .fn()
          .mockResolvedValue({ missions: [mission1], progress: { m1: zero } }),
        subscribe: jest
          .fn()
          .mockImplementation((cb: (u: SDKUpdate) => void) => {
            pushSse = cb;
            return jest.fn();
          }),
        onFireEventSuccess: jest
          .fn()
          .mockImplementation((cb: (ids: string[]) => void) => {
            pushOptimistic = cb;
            return jest.fn();
          }),
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // Fire two optimistic bumps back-to-back → currentCount goes 0 → 2.
      act(() => pushOptimistic?.(["m1"]));
      act(() => pushOptimistic?.(["m1"]));
      expect(result.current.data?.progress.m1?.currentCount).toBe(2);

      // SSE for event #1 arrives late with currentCount: 1 (below optimistic).
      // Monotonic guard must hold the counter at 2.
      const lateSse1: MissionProgress = {
        ...zero,
        currentCount: 1,
        progress: 0.2,
        updatedAt: 100,
      };
      act(() => pushSse?.({ type: "mission.progress", data: lateSse1 }));
      expect(result.current.data?.progress.m1?.currentCount).toBe(2);
      // Authoritative non-count fields still come through.
      expect(result.current.data?.progress.m1?.updatedAt).toBe(100);

      // SSE for event #2 arrives with currentCount: 2 (caught up). No change.
      const lateSse2: MissionProgress = {
        ...zero,
        currentCount: 2,
        progress: 0.4,
        updatedAt: 200,
      };
      act(() => pushSse?.({ type: "mission.progress", data: lateSse2 }));
      expect(result.current.data?.progress.m1?.currentCount).toBe(2);
      expect(result.current.data?.progress.m1?.updatedAt).toBe(200);

      // Server overshoots (e.g. another event fired elsewhere) — accept it.
      const sseAhead: MissionProgress = {
        ...zero,
        currentCount: 5,
        progress: 1,
        updatedAt: 300,
      };
      act(() => pushSse?.({ type: "mission.progress", data: sseAhead }));
      expect(result.current.data?.progress.m1?.currentCount).toBe(5);
      expect(result.current.data?.progress.m1?.updatedAt).toBe(300);
    });
  });
});
