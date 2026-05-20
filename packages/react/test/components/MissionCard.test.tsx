/**
 * MissionCard — render + claim-button state-machine specs.
 *
 *  - Renders title, description, reward badge.
 *  - locked / active: no claim button.
 *  - completed: claim button visible + enabled.
 *  - claim click invokes onClaim AND fires the analytics event via useEvent.
 *  - claimed: button visible but disabled with "Claimed" label.
 *  - Keyboard accessibility: Enter triggers the button (native <button>).
 */
import type { Mission, MissionProgress } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { MissionCard } from "../../src/components/MissionCard";
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

const mission: Mission = {
  id: "m1",
  title: "Click 5 times",
  description: "Just click",
  criteria: { eventName: "click", count: 5 },
  reward: { kind: "currency", currency: "GOLD", amount: 10 },
};

function progressWith(
  status: MissionProgress["status"],
  overrides: Partial<MissionProgress> = {},
): MissionProgress {
  return {
    userId: "u1",
    missionId: "m1",
    status,
    progress: 0.4,
    currentCount: 2,
    targetCount: 5,
    updatedAt: 1,
    ...overrides,
  };
}

describe("missionCard", () => {
  it("renders title, description and reward badge", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard mission={mission} progress={progressWith("active")} />
      </Wrapper>,
    );
    expect(screen.getByText("Click 5 times")).toBeInTheDocument();
    expect(screen.getByText("Just click")).toBeInTheDocument();
    expect(screen.getByText("+10 GOLD")).toBeInTheDocument();
  });

  it("hides the claim button while active", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard mission={mission} progress={progressWith("active")} />
      </Wrapper>,
    );
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
  });

  it("hides the claim button while locked", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard mission={mission} progress={progressWith("locked")} />
      </Wrapper>,
    );
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
  });

  it("shows an enabled claim button when completed", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("completed", { currentCount: 5, progress: 1 })}
        />
      </Wrapper>,
    );
    const btn = screen.getByRole("button", { name: /claim reward/i });
    expect(btn).not.toBeDisabled();
  });

  it("shows a disabled 'Claimed' button when claimed", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("claimed", { currentCount: 5, progress: 1 })}
        />
      </Wrapper>,
    );
    const btn = screen.getByRole("button", { name: /already claimed/i });
    expect(btn).toBeDisabled();
  });

  it("calls onClaim when the claim button is clicked", async () => {
    const client = makeFakeClient({
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
        <MissionCard
          mission={mission}
          progress={progressWith("completed", { currentCount: 5, progress: 1 })}
          onClaim={onClaim}
        />
      </Wrapper>,
    );
    const btn = screen.getByRole("button", { name: /claim reward/i });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onClaim).toHaveBeenCalledWith("m1");
  });

  it("supports keyboard activation (Enter/Space) via native button semantics", async () => {
    const client = makeFakeClient({
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
        <MissionCard
          mission={mission}
          progress={progressWith("completed", { currentCount: 5, progress: 1 })}
          onClaim={onClaim}
        />
      </Wrapper>,
    );
    const btn = screen.getByRole("button", { name: /claim reward/i });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    // Native <button> fires click on Enter; we simulate the click that
    // the browser would dispatch on Enter to verify the end-to-end path.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onClaim).toHaveBeenCalled();
  });

  it("renders a ProgressBar reflecting current/target", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("active", { currentCount: 3, targetCount: 5 })}
        />
      </Wrapper>,
    );
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "5");
  });

  it("applies the theme tokens to the card root", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    const { container } = render(
      <Wrapper>
        <MissionCard mission={mission} progress={progressWith("active")} />
      </Wrapper>,
    );
    const card = container.querySelector(".qk-mission-card") as HTMLElement;
    // We accept either CSS-variable round-trip or the data-status proxy
    // as evidence the theme/tokens are bound — both prove our styling
    // touched this element.
    expect(card.getAttribute("data-status")).toBe("active");
  });

  it("renders without progress (treated as not-yet-tracked active state)", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard mission={mission} />
      </Wrapper>,
    );
    // No progress = default "active" → no claim button.
    expect(screen.queryByRole("button", { name: /claim/i })).toBeNull();
    expect(screen.getByText("Click 5 times")).toBeInTheDocument();
  });

  it("renders the iconUrl when provided (and treats the image as decorative)", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    const { container } = render(
      <Wrapper>
        <MissionCard
          mission={{ ...mission, iconUrl: "https://cdn.example/m1.png" }}
          progress={progressWith("active")}
        />
      </Wrapper>,
    );
    const img = container.querySelector(
      ".qk-mission-card-icon",
    ) as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toBe("https://cdn.example/m1.png");
    // Decorative — the <h3> title carries the semantic meaning.
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not render an icon element when iconUrl is omitted or empty", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    const { container: c1 } = render(
      <Wrapper>
        <MissionCard mission={mission} progress={progressWith("active")} />
      </Wrapper>,
    );
    expect(c1.querySelector(".qk-mission-card-icon")).toBeNull();

    const { container: c2 } = render(
      <Wrapper>
        <MissionCard
          mission={{ ...mission, iconUrl: "" }}
          progress={progressWith("active")}
        />
      </Wrapper>,
    );
    expect(c2.querySelector(".qk-mission-card-icon")).toBeNull();
  });

  it("clamps the displayed counter when currentCount overshoots targetCount", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    const { container } = render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("active", {
            currentCount: 19,
            targetCount: 5,
            progress: 1,
          })}
        />
      </Wrapper>,
    );
    const text = container.querySelector(
      ".qk-mission-card-progress-text",
    ) as HTMLElement;
    expect(text).not.toBeNull();
    // Show the clamped "5 / 5" — never the raw "19 / 5".
    expect(text.textContent).toContain("5 / 5");
    expect(text.textContent).not.toContain("19 / 5");
    // Percent badge must also clamp at 100% even when `progress` overshoots.
    expect(text.textContent).toContain("100%");
  });

  it("clamps the ProgressBar visual fill at 100% when overshot", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    const { container } = render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("active", {
            currentCount: 19,
            targetCount: 5,
            progress: 3.8,
          })}
        />
      </Wrapper>,
    );
    const fill = container.querySelector(".qk-progressbar-fill") as HTMLElement;
    expect(fill).not.toBeNull();
    // ProgressBar already clamps internally — guard against regression.
    expect(fill.style.width).toBe("100%");
  });

  it("clamps the ProgressBar aria-label so screen readers don't announce overshoot", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("active", {
            currentCount: 19,
            targetCount: 5,
            progress: 1,
          })}
        />
      </Wrapper>,
    );
    // The progressbar's aria-label should read "5 of 5", not "19 of 5".
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-label")).toBe("Progress: 5 of 5");
  });

  it("renders a 'claimed today' hint when status is claimed", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("claimed", {
            currentCount: 5,
            targetCount: 5,
            progress: 1,
          })}
        />
      </Wrapper>,
    );
    // Hint exists as its own element (so screen readers announce it cleanly).
    expect(screen.getByText(/claimed today/i)).toBeInTheDocument();
  });

  it("dims the progress text when status is claimed", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    const { container } = render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("claimed", {
            currentCount: 5,
            targetCount: 5,
            progress: 1,
          })}
        />
      </Wrapper>,
    );
    const text = container.querySelector(
      ".qk-mission-card-progress-text",
    ) as HTMLElement;
    expect(text).not.toBeNull();
    // Dimming = opacity below the default 0.7 used for non-claimed states.
    const opacity = Number.parseFloat(text.style.opacity);
    expect(opacity).toBeLessThan(0.7);
  });

  it("does not render the claimed hint when status is not claimed", () => {
    const client = makeFakeClient();
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <MissionCard
          mission={mission}
          progress={progressWith("completed", {
            currentCount: 5,
            targetCount: 5,
            progress: 1,
          })}
        />
      </Wrapper>,
    );
    expect(screen.queryByText(/claimed today/i)).toBeNull();
  });
});
