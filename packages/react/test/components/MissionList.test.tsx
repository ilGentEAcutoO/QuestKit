/**
 * MissionList — loading / error / empty / loaded specs + Load More.
 *
 *  - Loading: role="status" + aria-busy="true".
 *  - Error: role="alert" + retry button calls refetch.
 *  - Empty: friendly "No missions yet." message.
 *  - Loaded: one MissionCard per mission.
 *  - Slices at 50 by default; surfaces a Load More button when there are
 *    more.
 *  - Forwards `campaignId` / `status` / `limit` to useMissions.
 *  - Forwards `onClaim` down to each card.
 */
import type { Mission, MissionProgress } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { MissionList } from "../../src/components/MissionList";
import { QuestKitProvider } from "../../src/provider";
import { type FakeClient, makeFakeClient } from "../hooks/test-utils";

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

function mkMission(i: number): Mission {
  return {
    id: `m${i}`,
    title: `Mission ${i}`,
    description: `Do thing ${i}`,
    criteria: { eventName: "click", count: 1 },
    reward: { kind: "currency", currency: "GOLD", amount: 1 },
  };
}

function mkProgress(
  id: string,
  status: MissionProgress["status"] = "active",
): MissionProgress {
  return {
    userId: "u1",
    missionId: id,
    status,
    progress: 0,
    currentCount: 0,
    targetCount: 1,
    updatedAt: 1,
  };
}

describe("missionList", () => {
  it("renders skeleton while loading", () => {
    const client = makeFakeClient({
      getMissions: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionList />
      </Wrapper>,
    );
    const list = screen.getByRole("status", { name: /loading missions/i });
    expect(list).toHaveAttribute("aria-busy", "true");
  });

  it("renders an empty state when no missions", async () => {
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue({ missions: [], progress: {} }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionList />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/no missions yet/i)).toBeInTheDocument();
  });

  it("renders one card per mission", async () => {
    const missions = [mkMission(1), mkMission(2), mkMission(3)];
    const progress: Record<string, MissionProgress> = {
      m1: mkProgress("m1"),
      m2: mkProgress("m2"),
      m3: mkProgress("m3"),
    };
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue({ missions, progress }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionList />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Mission 1")).toBeInTheDocument();
    expect(screen.getByText("Mission 2")).toBeInTheDocument();
    expect(screen.getByText("Mission 3")).toBeInTheDocument();
  });

  it("renders error state with retry button", async () => {
    let calls = 0;
    const client = makeFakeClient({
      getMissions: jest.fn().mockImplementation(() => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("boom"));
        return Promise.resolve({ missions: [], progress: {} });
      }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionList />
      </Wrapper>,
    );
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn’t load missions/i);
    const retry = screen.getByRole("button", { name: /retry/i });
    await act(async () => {
      fireEvent.click(retry);
    });
    // After retry, second call resolves → empty state shows.
    expect(await screen.findByText(/no missions yet/i)).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it("forwards campaignId + status + limit to useMissions opts", async () => {
    const getMissions = jest
      .fn()
      .mockResolvedValue({ missions: [], progress: {} });
    const client = makeFakeClient({ getMissions });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionList campaignId="c1" status="active" limit={5} />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getMissions).toHaveBeenCalledWith({
      campaignId: "c1",
      status: "active",
      limit: 5,
    });
  });

  it("shows a Load More button when results exceed the slice cap", async () => {
    const missions = Array.from({ length: 60 }, (_, i) => mkMission(i + 1));
    const progress: Record<string, MissionProgress> = {};
    for (const m of missions) progress[m.id] = mkProgress(m.id);
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue({ missions, progress }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionList />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Default cap is 50 → 10 hidden.
    const loadMore = screen.getByRole("button", {
      name: /load more missions/i,
    });
    expect(loadMore).toBeInTheDocument();
    // First 50 visible.
    expect(screen.getByText("Mission 1")).toBeInTheDocument();
    expect(screen.getByText("Mission 50")).toBeInTheDocument();
    expect(screen.queryByText("Mission 60")).toBeNull();
    // Click → cap grows by 50, all visible.
    await act(async () => {
      fireEvent.click(loadMore);
    });
    expect(screen.getByText("Mission 60")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /load more missions/i }),
    ).toBeNull();
  });

  it("propagates onClaim down to MissionCard buttons", async () => {
    const missions = [mkMission(1)];
    const progress: Record<string, MissionProgress> = {
      m1: mkProgress("m1", "completed"),
    };
    const client = makeFakeClient({
      getMissions: jest.fn().mockResolvedValue({ missions, progress }),
      fireEvent: jest.fn().mockResolvedValue({
        accepted: true,
        eventId: "e",
        missionsUpdated: [],
      }),
    });
    const Wrapper = wrapperWith(client);
    const onClaim = jest.fn().mockResolvedValue(undefined);
    render(
      <Wrapper>
        <MissionList onClaim={onClaim} />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const btn = await screen.findByRole("button", { name: /claim reward/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onClaim).toHaveBeenCalledWith("m1");
  });

  // Phase 9 / TASK-001 Cluster C1 — after onClaim resolves the list MUST
  // refetch its own missions so the card converges to status="claimed"
  // even when the SSE `mission.claimed` broadcast drops. The card display
  // logic already handles the flipped status; this test pins the
  // belt-and-suspenders behaviour so a regression doesn't reintroduce bug
  // B1 on /ecommerce (where MissionList owns the useMissions instance and
  // the route can't reach into its refetch directly).
  it("refetches its own missions after onClaim resolves (SSE-degraded fallback)", async () => {
    const initialMissions = [mkMission(1)];
    const initialProgress: Record<string, MissionProgress> = {
      m1: mkProgress("m1", "completed"),
    };
    // Second fetch returns the same mission but with status="claimed".
    const claimedProgress: Record<string, MissionProgress> = {
      m1: mkProgress("m1", "claimed"),
    };
    const getMissions = jest
      .fn()
      .mockResolvedValueOnce({
        missions: initialMissions,
        progress: initialProgress,
      })
      .mockResolvedValueOnce({
        missions: initialMissions,
        progress: claimedProgress,
      });
    const client = makeFakeClient({
      getMissions,
      fireEvent: jest.fn().mockResolvedValue({
        accepted: true,
        eventId: "e",
        missionsUpdated: [],
      }),
    });
    const Wrapper = wrapperWith(client);
    const onClaim = jest.fn().mockResolvedValue(undefined);
    render(
      <Wrapper>
        <MissionList onClaim={onClaim} />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(getMissions).toHaveBeenCalledTimes(1);
    const btn = await screen.findByRole("button", { name: /claim reward/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    // The wrapper must have invoked the caller's onClaim AND triggered a
    // self-refetch (second client.getMissions call). The order matters:
    // the refetch fires after onClaim resolves, so the toast in the host
    // app lands before the card data is overwritten.
    expect(onClaim).toHaveBeenCalledWith("m1");
    expect(getMissions).toHaveBeenCalledTimes(2);
  });
});
