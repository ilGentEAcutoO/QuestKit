/**
 * RewardClaimToast — host + hook + auto-dismiss specs.
 *
 *  - Host portals into document.body (verified by querying body directly).
 *  - useRewardClaimToast().show() causes a toast to render inside the host.
 *  - Auto-dismiss after 4s by default (fake timers).
 *  - Dismiss button removes the toast immediately.
 *  - When no host is mounted, show() is a no-op (no crash).
 *  - aria-live="polite" on the portal region.
 *  - For badge / item reward kinds, the label reflects the kind.
 */
import type { Reward } from "@questkit/types";
import type { ReactElement } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import {
  RewardClaimToastHost,
  useRewardClaimToast,
} from "../../src/components/RewardClaimToast";

/**
 * Test harness: mounts the host plus a hook-bound trigger button that can
 * be clicked to call `show()` from inside the same React tree. Co-locating
 * everything in one `render()` avoids cross-test DOM lifecycle race
 * conditions that bite when you mix `render()` + `renderHook()` against a
 * portal target on document.body.
 */
function Harness(props: { reward: Reward; durationMs?: number }): ReactElement {
  const { show } = useRewardClaimToast();
  return (
    <>
      <RewardClaimToastHost
        {...(props.durationMs !== undefined
          ? { durationMs: props.durationMs }
          : {})}
      />
      <button
        type="button"
        onClick={(): void => show(props.reward)}
        data-testid="qk-show-toast"
      >
        Show
      </button>
    </>
  );
}

describe("rewardClaimToast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    // Drain any pending dismiss timers so RTL's cleanup unmount is clean.
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("mounts the host as a portal under document.body", () => {
    render(
      <Harness reward={{ kind: "currency", currency: "GOLD", amount: 1 }} />,
    );
    act(() => {
      jest.advanceTimersByTime(0);
    });
    const host = document.body.querySelector(".qk-toast-host");
    expect(host).not.toBeNull();
    // The portal target is document.body — the host should be a direct
    // child, not nested inside the RTL test container.
    expect(host?.parentElement).toBe(document.body);
    expect(host?.getAttribute("aria-live")).toBe("polite");
  });

  it("renders nothing visible before show() is called", () => {
    render(
      <Harness reward={{ kind: "currency", currency: "GOLD", amount: 1 }} />,
    );
    act(() => {
      jest.advanceTimersByTime(0);
    });
    const host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(0);
  });

  it("renders a toast when show() is called", () => {
    render(
      <Harness reward={{ kind: "currency", currency: "GOLD", amount: 50 }} />,
    );
    act(() => {
      jest.advanceTimersByTime(0);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("qk-show-toast"));
    });
    const host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(1);
    expect(host.textContent).toContain("+50 GOLD");
  });

  it("auto-dismisses after 4s by default", () => {
    render(
      <Harness reward={{ kind: "currency", currency: "GOLD", amount: 1 }} />,
    );
    act(() => {
      jest.advanceTimersByTime(0);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("qk-show-toast"));
    });
    let host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(1);
    act(() => {
      jest.advanceTimersByTime(4000);
    });
    host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(0);
  });

  it("honours a custom durationMs", () => {
    render(
      <Harness
        reward={{ kind: "currency", currency: "GOLD", amount: 1 }}
        durationMs={1000}
      />,
    );
    act(() => {
      jest.advanceTimersByTime(0);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("qk-show-toast"));
    });
    let host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(1);
    act(() => {
      jest.advanceTimersByTime(999);
    });
    host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(1);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(0);
  });

  it("renders a dismiss button that removes the toast immediately", () => {
    render(<Harness reward={{ kind: "badge", badgeId: "first-blood" }} />);
    act(() => {
      jest.advanceTimersByTime(0);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("qk-show-toast"));
    });
    const dismiss = screen.getByRole("button", { name: /dismiss reward/i });
    act(() => {
      fireEvent.click(dismiss);
    });
    const host = document.body.querySelector(".qk-toast-host") as HTMLElement;
    expect(host.querySelectorAll(".qk-toast").length).toBe(0);
  });

  it("formats badge rewards", () => {
    render(<Harness reward={{ kind: "badge", badgeId: "first-blood" }} />);
    act(() => {
      jest.advanceTimersByTime(0);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("qk-show-toast"));
    });
    expect(
      document.body.querySelector(".qk-toast-host")?.textContent,
    ).toContain("Badge: first-blood");
  });

  it("formats item rewards", () => {
    render(<Harness reward={{ kind: "item", itemId: "sword", quantity: 3 }} />);
    act(() => {
      jest.advanceTimersByTime(0);
    });
    act(() => {
      fireEvent.click(screen.getByTestId("qk-show-toast"));
    });
    expect(
      document.body.querySelector(".qk-toast-host")?.textContent,
    ).toContain("3× sword");
  });

  it("does not crash when show() is called with no host mounted", () => {
    // Render only the trigger, no host.
    function NoHost(): ReactElement {
      const { show } = useRewardClaimToast();
      return (
        <button
          type="button"
          data-testid="qk-no-host-trigger"
          onClick={(): void =>
            show({ kind: "currency", currency: "GOLD", amount: 1 })
          }
        >
          fire
        </button>
      );
    }
    render(<NoHost />);
    expect(() => {
      act(() => {
        fireEvent.click(screen.getByTestId("qk-no-host-trigger"));
      });
    }).not.toThrow();
  });
});
