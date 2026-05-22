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

  // TASK-012 / F3 regression — no double-bump from optimistic + SSE.
  //
  // History: v0.1.4 (TASK-006) added an optimistic +1 path via
  // `client.onFireEventSuccess` so the counter advanced instantly after
  // POST /v1/events returned, without waiting for the SSE delivery. The
  // SSE handler already applied a monotonic `Math.max` merge on
  // `currentCount`, so the two paths were considered additive: SSE
  // overwrote the optimistic value only if it exceeded it.
  //
  // The double-bump defect: in the normal happy path BOTH the POST
  // response AND the SSE delivery arrive for the same event. SSE landed
  // first → `Math.max` settled the count at the server's value, then the
  // optimistic +1 bumped it ONE PAST the server. Every event advanced the
  // display by 2 while the server-authoritative count advanced by 1.
  // Eventually the display reached `targetCount` while the server stayed
  // below, and `POST /v1/missions/:id/claim` returned 409
  // `claim_not_ready`.
  //
  // v0.1.11 (TASK-012) dropped the optimistic path entirely. SSE is now
  // the sole source of progress updates. These regression tests pin that
  // contract:
  //   - 1 fireEvent + 1 SSE delivery = +1 on the display (NOT +2).
  //   - fireEvent without SSE delivery does NOT advance the display.
  //   - The monotonic merge still guards against out-of-order SSE.
  describe("f3 regression — no double-bump from optimistic + SSE", () => {
    it("1 fireEvent + 1 SSE delivery results in +1 on display (not +2)", async () => {
      let pushSse: ((u: SDKUpdate) => void) | null = null;
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const zero: MissionProgress = {
        ...progress1,
        missionId: "mis_test",
        currentCount: 0,
        progress: 0,
      };
      const client = makeFakeClient({
        getMissions: jest.fn().mockResolvedValue({
          missions: [{ ...mission1, id: "mis_test" }],
          progress: { mis_test: zero },
        }),
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

      // Simulate the happy-path race: POST /v1/events returns with the
      // mission acknowledged, AND the SSE_HUB DO delivers
      // `mission.progress` for the same event with currentCount=1.
      // Order doesn't matter for the +1 contract.
      act(() => {
        pushOptimistic?.(["mis_test"]);
        pushSse?.({
          type: "mission.progress",
          data: { ...zero, currentCount: 1, progress: 1 / 5 },
        });
      });

      // The display must NOT have double-bumped to 2. Pre-v0.1.11 this
      // assertion would fail (display=2 from monotonic-max-of-SSE +
      // optimistic-+1-from-existing-1).
      expect(result.current.data?.progress.mis_test?.currentCount).toBe(1);
    });

    it("fireEvent without SSE delivery does NOT advance the display (optimistic path removed)", async () => {
      let pushOptimistic: ((ids: string[]) => void) | null = null;
      const client = makeFakeClient({
        getMissions: jest.fn().mockResolvedValue({
          missions: [mission1],
          progress: { m1: progress1 },
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

      // Fire several optimistic acks. Pre-v0.1.11 each would have bumped
      // currentCount by +1; post-fix the display must stay put because SSE
      // never landed.
      act(() => pushOptimistic?.(["m1"]));
      act(() => pushOptimistic?.(["m1"]));
      act(() => pushOptimistic?.(["m1"]));

      expect(result.current.data?.progress.m1?.currentCount).toBe(
        progress1.currentCount,
      );
      expect(result.current.data?.progress.m1?.updatedAt).toBe(
        progress1.updatedAt,
      );
    });

    it("emits a console.debug log with the expected shape on each accepted SSE delivery", async () => {
      const debugSpy = jest
        .spyOn(console, "debug")
        .mockImplementation(() => {});
      try {
        let pushSse: ((u: SDKUpdate) => void) | null = null;
        const client = makeFakeClient({
          getMissions: jest.fn().mockResolvedValue({
            missions: [mission1],
            progress: { m1: progress1 },
          }),
          subscribe: jest
            .fn()
            .mockImplementation((cb: (u: SDKUpdate) => void) => {
              pushSse = cb;
              return jest.fn();
            }),
        });
        const { result } = renderHook(() => useMissions(), {
          wrapper: wrapperWith(client),
        });
        await waitFor(() => expect(result.current.isSuccess).toBe(true));

        const next: MissionProgress = {
          ...progress1,
          currentCount: 2,
          progress: 0.4,
          updatedAt: 42,
        };
        act(() => pushSse?.({ type: "mission.progress", data: next }));

        expect(debugSpy).toHaveBeenCalledWith(
          "[questkit:mission] SSE update",
          expect.objectContaining({
            missionId: "m1",
            type: "mission.progress",
            before: progress1.currentCount,
            after: next.currentCount,
          }),
        );
      } finally {
        debugSpy.mockRestore();
      }
    });

    // Regression: even without an optimistic path, the SSE merge MUST stay
    // monotonic on currentCount to handle out-of-order SSE delivery for
    // back-to-back events. Without this guard a user could see the counter
    // snap backwards (e.g. 3 → 2 → 3) when event-N's SSE arrives before
    // event-(N-1)'s. See the merge policy docblock at the top of
    // useMissions.ts.
    it("monotonic merge: SSE never lowers currentCount on mission.progress", async () => {
      const zero: MissionProgress = {
        ...progress1,
        currentCount: 0,
        progress: 0,
      };
      let pushSse: ((u: SDKUpdate) => void) | null = null;
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
      });
      const { result } = renderHook(() => useMissions(), {
        wrapper: wrapperWith(client),
      });
      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      // SSE for event #2 arrives first with currentCount: 2.
      const sse2: MissionProgress = {
        ...zero,
        currentCount: 2,
        progress: 0.4,
        updatedAt: 200,
      };
      act(() => pushSse?.({ type: "mission.progress", data: sse2 }));
      expect(result.current.data?.progress.m1?.currentCount).toBe(2);

      // SSE for event #1 arrives late with currentCount: 1 (below current).
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
