/**
 * CoinBalance — display + animation specs.
 *
 * Behaviour:
 *   - Renders the balance from `useBalance(currency)`.
 *   - Shows 0 when no balance loaded.
 *   - aria-label = "<amount> <currency>".
 *   - aria-busy reflects loading state.
 *   - When `animated`, the rolling counter walks the displayed value
 *     toward the target via rAF and finishes at the target.
 *   - Respects prefers-reduced-motion by snapping immediately.
 */
import type { Balance, SDKUpdate } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";

import { CoinBalance } from "../../src/components/CoinBalance";
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

const gold: Balance = {
  userId: "u1",
  currency: "GOLD",
  amount: 100,
  updatedAt: 1,
};

describe("coinBalance", () => {
  it("renders without crashing", async () => {
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(null),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CoinBalance currency="GOLD" />
      </Wrapper>,
    );
    // Drain the hook's resolve so React isn't yelling about an unwrapped
    // setState during cleanup.
    await act(async () => {
      await Promise.resolve();
    });
    const node = document.querySelector(".qk-coin-balance");
    expect(node).not.toBeNull();
  });

  it("shows the loaded balance number", async () => {
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(gold),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CoinBalance currency="GOLD" />
      </Wrapper>,
    );
    // Run microtasks so the hook's promise resolves and React commits.
    await act(async () => {
      await Promise.resolve();
    });
    // The displayed amount is 100. With animated=false (default), it snaps.
    expect(screen.getByLabelText("100 GOLD")).toBeInTheDocument();
  });

  it("includes the currency code in the rendered DOM", async () => {
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(gold),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CoinBalance currency="GOLD" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.querySelector('[data-currency="GOLD"]')).not.toBeNull();
  });

  it("uses the coin theme token on its number style", async () => {
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(null),
    });
    const Wrapper = wrapperWith(client);
    const { container } = render(
      <Wrapper>
        <CoinBalance currency="GOLD" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const node = container.querySelector(".qk-coin-balance") as HTMLElement;
    // The component sets --qk-coin to the coin token via inline style.
    expect(node.style.getPropertyValue("--qk-coin")).toContain(
      "--color-qk-coin",
    );
  });

  it("rolls the displayed number via rAF when animated", async () => {
    // We patch rAF to invoke its callback synchronously, then advance the
    // perf-clock manually so easing reaches 1 in a finite number of steps.
    let perfNow = 0;
    const originalNow = performance.now.bind(performance);
    performance.now = (): number => perfNow;
    const callbacks: FrameRequestCallback[] = [];
    const originalRaf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      callbacks.push(cb);
      return callbacks.length;
    };
    globalThis.cancelAnimationFrame = (): void => {};

    try {
      let pushUpdate: ((u: SDKUpdate) => void) | null = null;
      const client = makeFakeClient({
        getBalance: jest.fn().mockResolvedValue({ ...gold, amount: 0 }),
        subscribe: jest
          .fn()
          .mockImplementation((cb: (u: SDKUpdate) => void) => {
            pushUpdate = cb;
            return jest.fn();
          }),
      });
      const Wrapper = wrapperWith(client);
      render(
        <Wrapper>
          <CoinBalance currency="GOLD" animated />
        </Wrapper>,
      );
      await act(async () => {
        await Promise.resolve();
      });

      // Push a change → component schedules a rAF tick.
      act(() => {
        pushUpdate?.({
          type: "balance.changed",
          data: { ...gold, amount: 100 },
        });
      });
      // Drain rAF queue, advancing the perf clock past the 300 ms duration.
      for (let i = 0; i < 20 && callbacks.length > 0; i++) {
        perfNow += 50;
        const cb = callbacks.shift();
        if (cb !== undefined) {
          act(() => cb(perfNow));
        }
      }
      // Eventually settles at 100.
      expect(screen.getByLabelText("100 GOLD")).toBeInTheDocument();
    } finally {
      performance.now = originalNow;
      globalThis.requestAnimationFrame = originalRaf;
    }
  });

  it("snaps when prefers-reduced-motion is set, even with animated=true", async () => {
    const mql = {
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    };
    const originalMM = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: jest.fn().mockReturnValue(mql),
    });
    try {
      let pushUpdate: ((u: SDKUpdate) => void) | null = null;
      const client = makeFakeClient({
        getBalance: jest.fn().mockResolvedValue({ ...gold, amount: 0 }),
        subscribe: jest
          .fn()
          .mockImplementation((cb: (u: SDKUpdate) => void) => {
            pushUpdate = cb;
            return jest.fn();
          }),
      });
      const Wrapper = wrapperWith(client);
      render(
        <Wrapper>
          <CoinBalance currency="GOLD" animated />
        </Wrapper>,
      );
      await act(async () => {
        await Promise.resolve();
      });
      act(() => {
        pushUpdate?.({
          type: "balance.changed",
          data: { ...gold, amount: 999 },
        });
      });
      // No rAF needed — snap.
      expect(screen.getByLabelText("999 GOLD")).toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        writable: true,
        value: originalMM,
      });
    }
  });

  it("snaps when animated=false on change (default)", async () => {
    let pushUpdate: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(gold),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        pushUpdate = cb;
        return jest.fn();
      }),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CoinBalance currency="GOLD" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Push a balance change SSE update.
    act(() => {
      pushUpdate?.({
        type: "balance.changed",
        data: { ...gold, amount: 500 },
      });
    });
    expect(screen.getByLabelText("500 GOLD")).toBeInTheDocument();
  });
});
