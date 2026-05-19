/**
 * RecommendedMissions — loading / error / empty / loaded + "Refreshes hourly"
 * caption when `cached: true`.
 *
 *  - Loading: role="status" + aria-busy="true".
 *  - Error: role="alert" with retry.
 *  - Empty: friendly message when missionIds is [].
 *  - Loaded: up to 3 MissionCards keyed by missionId; AI's reason rendered
 *    as a subtle caption above the cards.
 *  - `cached: true` → "Refreshes hourly" hint visible.
 *  - `cached: false` → hint absent.
 */
import type { Mission, MissionProgress } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

import { RecommendedMissions } from "../../src/components/RecommendedMissions";
import { __clearRecommendationsCacheForTests } from "../../src/hooks/useRecommendations";
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

function mkMission(id: string, title: string): Mission {
  return {
    id,
    title,
    description: `desc ${title}`,
    criteria: { eventName: "click", count: 1 },
    reward: { kind: "currency", currency: "GOLD", amount: 1 },
  };
}

function mkProgress(missionId: string): MissionProgress {
  return {
    userId: "u1",
    missionId,
    status: "active",
    progress: 0,
    currentCount: 0,
    targetCount: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  __clearRecommendationsCacheForTests();
});

describe("recommendedMissions", () => {
  it("renders a loading state while the recommendations resolve", () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockReturnValue(new Promise(() => {})),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <RecommendedMissions />
      </Wrapper>,
    );
    const status = screen.getByRole("status", {
      name: /loading recommendations/i,
    });
    expect(status).toHaveAttribute("aria-busy", "true");
  });

  it("renders an empty state when the AI returns no recommendations", async () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue({
        missionIds: [],
        reason: "Start firing events to unlock personalised missions.",
        cached: false,
        count: 0,
      }),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <RecommendedMissions />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByText(/no recommendations yet/i)).toBeInTheDocument(),
    );
  });

  it("renders the AI's reason as a caption and one MissionCard per missionId (up to 3)", async () => {
    const m1 = mkMission("mis_a", "Alpha Quest");
    const m2 = mkMission("mis_b", "Beta Quest");
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue({
        missionIds: ["mis_a", "mis_b"],
        reason: "You’ve been crushing daily logins — keep the streak!",
        cached: false,
        count: 2,
      }),
      getUserId: jest.fn().mockResolvedValue("u1"),
      getMission: jest.fn().mockImplementation(async (id: string) => {
        if (id === "mis_a") return { mission: m1, progress: mkProgress(m1.id) };
        if (id === "mis_b") return { mission: m2, progress: mkProgress(m2.id) };
        throw new Error(`unexpected id ${id}`);
      }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <RecommendedMissions />
      </Wrapper>,
    );

    // Reason rendered.
    await waitFor(() =>
      expect(screen.getByText(/crushing daily logins/i)).toBeInTheDocument(),
    );
    // Both mission cards rendered (heading by title).
    expect(
      screen.getByRole("heading", { name: /alpha quest/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /beta quest/i }),
    ).toBeInTheDocument();
  });

  it("renders an error state when getRecommendations rejects", async () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockRejectedValue(new Error("boom")),
      getUserId: jest.fn().mockResolvedValue("u1"),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <RecommendedMissions />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("renders the 'Refreshes hourly' hint when cached:true", async () => {
    const m1 = mkMission("mis_a", "Alpha Quest");
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue({
        missionIds: ["mis_a"],
        reason: "We've cached this for you.",
        cached: true,
        count: 1,
      }),
      getUserId: jest.fn().mockResolvedValue("u1"),
      getMission: jest.fn().mockResolvedValue({
        mission: m1,
        progress: mkProgress(m1.id),
      }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <RecommendedMissions />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText(/refreshes hourly/i)).toBeInTheDocument(),
    );
  });

  it("does NOT render the 'Refreshes hourly' hint when cached:false", async () => {
    const m1 = mkMission("mis_a", "Alpha Quest");
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue({
        missionIds: ["mis_a"],
        reason: "Fresh.",
        cached: false,
        count: 1,
      }),
      getUserId: jest.fn().mockResolvedValue("u1"),
      getMission: jest.fn().mockResolvedValue({
        mission: m1,
        progress: mkProgress(m1.id),
      }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <RecommendedMissions />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.getByText(/fresh\./i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/refreshes hourly/i)).not.toBeInTheDocument();
  });
});
