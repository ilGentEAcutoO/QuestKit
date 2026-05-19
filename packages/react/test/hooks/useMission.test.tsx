import type { Mission, MissionProgress, SDKUpdate } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";

import { QuestKitError } from "@questkit/core";
/**
 * useMission — TDD specs.
 *
 * Behaviour:
 *   1. Loading state initially.
 *   2. Resolves with { mission, progress } from getMission(id).
 *   3. mission.progress SSE for the SAME id updates `data.progress`.
 *   4. mission.completed SSE for the SAME id updates `data.progress`.
 *   5. mission.progress for a DIFFERENT id is ignored.
 *   6. Other update types are ignored.
 *   7. Unmount unsubscribes.
 *   8. Errors surface via `error`.
 *   9. id change triggers a refetch.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

import { useMission } from "../../src/hooks/useMission";
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

const mission: Mission = {
  id: "m1",
  title: "T",
  description: "D",
  criteria: { eventName: "x", count: 1 },
  reward: { kind: "currency", currency: "GOLD", amount: 1 },
};

const progress: MissionProgress = {
  userId: "u1",
  missionId: "m1",
  status: "active",
  progress: 0,
  currentCount: 0,
  targetCount: 1,
  updatedAt: 1,
};

describe("useMission", () => {
  it("returns loading state initially", () => {
    const client = makeFakeClient({
      getMission: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const { result } = renderHook(() => useMission("m1"), {
      wrapper: wrapperWith(client),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
  });

  it("resolves with mission + progress", async () => {
    const client = makeFakeClient({
      getMission: jest.fn().mockResolvedValue({ mission, progress }),
    });
    const { result } = renderHook(() => useMission("m1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ mission, progress });
    expect(client.getMission).toHaveBeenCalledWith("m1");
  });

  it("records errors", async () => {
    const boom = new QuestKitError("missing", "not_found", 404);
    const client = makeFakeClient({
      getMission: jest.fn().mockRejectedValue(boom),
    });
    const { result } = renderHook(() => useMission("m1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
  });

  it("applies SSE updates for the same mission id", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getMission: jest.fn().mockResolvedValue({ mission, progress }),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useMission("m1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const next: MissionProgress = { ...progress, currentCount: 1, progress: 1 };
    act(() => {
      push?.({ type: "mission.completed", data: next });
    });
    expect(result.current.data?.progress).toEqual(next);
  });

  it("ignores SSE updates for a different mission id", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getMission: jest.fn().mockResolvedValue({ mission, progress }),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useMission("m1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const otherProgress: MissionProgress = {
      ...progress,
      missionId: "m2",
      currentCount: 99,
    };
    act(() => {
      push?.({ type: "mission.progress", data: otherProgress });
    });
    expect(result.current.data?.progress).toEqual(progress);
  });

  it("unsubscribes on unmount", async () => {
    const unsub = jest.fn();
    const client = makeFakeClient({
      getMission: jest.fn().mockResolvedValue({ mission, progress }),
      subscribe: jest.fn().mockReturnValue(unsub),
    });
    const { unmount, result } = renderHook(() => useMission("m1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("wraps non-QuestKitError throws into a network_error QuestKitError", async () => {
    const client = makeFakeClient({
      getMission: jest.fn().mockRejectedValue(new Error("zz")),
    });
    const { result } = renderHook(() => useMission("m1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(QuestKitError);
    expect(result.current.error?.code).toBe("network_error");
  });

  it("refetches when id changes", async () => {
    const mission2: Mission = { ...mission, id: "m2", title: "Other" };
    const progress2: MissionProgress = { ...progress, missionId: "m2" };
    const getMission = jest
      .fn()
      .mockResolvedValueOnce({ mission, progress })
      .mockResolvedValueOnce({ mission: mission2, progress: progress2 });
    const client = makeFakeClient({ getMission });
    const { result, rerender } = renderHook(({ id }) => useMission(id), {
      wrapper: wrapperWith(client),
      initialProps: { id: "m1" },
    });
    await waitFor(() => expect(result.current.data?.mission.id).toBe("m1"));
    rerender({ id: "m2" });
    await waitFor(() => expect(result.current.data?.mission.id).toBe("m2"));
    expect(getMission).toHaveBeenCalledWith("m1");
    expect(getMission).toHaveBeenCalledWith("m2");
  });
});
