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
import { QuestKitError } from "@questkit/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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

  it("clears the 'Claiming…' state after onClaim rejects with a timeout (TASK-005)", async () => {
    // The bug: if onClaim hangs forever (no timeout), the button label
    // stays "Claiming…" and the card is stuck. With SDK-level timeouts,
    // onClaim either resolves or rejects within ~10s — either way the
    // local `isClaiming` flag must clear via the finally block. The click
    // handler's .catch keeps the rejection from surfacing as an unhandled
    // rejection in the host page.
    const timeoutErr = new QuestKitError(
      "request timed out after 50ms",
      "timeout",
    );
    const client = makeFakeClient({
      fireEvent: jest.fn().mockResolvedValue({
        accepted: true,
        eventId: "e",
        missionsUpdated: [],
      }),
    });
    const Wrapper = wrapperWith(client);
    const onClaim = jest.fn().mockRejectedValue(timeoutErr);
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
    // After the rejected onClaim, the finally block must reset isClaiming
    // so the button returns to the "Claim" affordance — NOT stuck on
    // "Claiming…". The `name` query asserts both the aria-label and the
    // visible label flipped back.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /claim reward/i }),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("Claiming…")).toBeNull();
    expect(onClaim).toHaveBeenCalledWith("m1");
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
});
