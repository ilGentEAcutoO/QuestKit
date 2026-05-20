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
 *  - `fallback: true` (Phase 8 / v0.1.4) → graceful empty-state copy ("AI
 *    picks unavailable right now") with NO raw error code. The component
 *    must NOT render the words `ai_response_malformed` or any 502/503
 *    error code regardless of payload contents.
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
    // Both mission cards rendered (heading by title). Each MissionCard depends
    // on its own getMission() promise resolving, so use findByRole (which
    // retries until found or 1000ms timeout) instead of getByRole — otherwise
    // CI runners with slower CPU can lose the race between reason-render and
    // card-render and intermittently fail this assertion.
    expect(
      await screen.findByRole("heading", { name: /alpha quest/i }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: /beta quest/i }),
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

  // ---------------------------------------------------------------------------
  // Phase 8 / v0.1.4 TASK-002 — fallback empty-state when AI is unavailable.
  // ---------------------------------------------------------------------------

  it("renders a tasteful empty-state when fallback:true", async () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue({
        missionIds: [],
        reason: "AI picks unavailable right now.",
        cached: false,
        count: 0,
        fallback: true,
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
      expect(
        screen.getByText(/ai picks unavailable right now/i),
      ).toBeInTheDocument(),
    );
    // The fallback UX must use status semantics, NOT alert — this is a
    // tasteful empty-state, not a red error.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does NOT leak raw error codes like 'ai_response_malformed' in fallback state", async () => {
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue({
        // Defensive: even if the server somehow leaks an error code into the
        // reason field, the component must not display it. We use a sentinel
        // that resembles the legacy 502 body and assert it never reaches DOM.
        missionIds: [],
        reason: "ai_response_malformed",
        cached: false,
        count: 0,
        fallback: true,
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
      expect(
        screen.getByText(/ai picks unavailable right now/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/ai_response_malformed/i),
    ).not.toBeInTheDocument();
  });

  it("does NOT render mission cards when fallback:true (even if missionIds is non-empty)", async () => {
    // Defensive contract: the only signal that matters is `fallback`. Even if
    // some odd server build returned ids alongside fallback, the UI must not
    // render them — the AI was deemed unavailable, so don't surface stale data.
    const m1 = mkMission("mis_a", "Should Not Appear");
    const client = makeFakeClient({
      getRecommendations: jest.fn().mockResolvedValue({
        missionIds: ["mis_a"],
        reason: "AI picks unavailable right now.",
        cached: false,
        count: 1,
        fallback: true,
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
      expect(
        screen.getByText(/ai picks unavailable right now/i),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("heading", { name: /should not appear/i }),
    ).not.toBeInTheDocument();
  });
});
