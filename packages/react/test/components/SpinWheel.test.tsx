/**
 * SpinWheel — RTL specs.
 *
 * Strategy: we never let the real `Math.random` / `crypto.getRandomValues`
 * decide the winner — every test mocks `crypto.getRandomValues` to return
 * a fixed uint32 so the picked index is deterministic. We also drive the
 * 4 s CSS transition by *manually* firing a `transitionend` event with
 * `propertyName: "transform"` — jsdom doesn't run CSS transitions.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";

import { pickWeightedIndex, SpinWheel } from "../../src/components/SpinWheel";

/**
 * jsdom doesn't ship a `TransitionEvent` constructor, so RTL's
 * `fireEvent.transitionEnd` falls back to a plain `Event` that drops the
 * `propertyName` field. We dispatch a custom event with `propertyName`
 * defined as an own property to mimic real browser behaviour.
 */
function fireTransformTransitionEnd(node: Element): void {
  const ev = new Event("transitionend", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "propertyName", { value: "transform" });
  node.dispatchEvent(ev);
}

/**
 * Replace `crypto.getRandomValues` so the next call writes our chosen
 * uint32 into the buffer. Returns a restore function.
 */
function stubGetRandomValues(value: number): () => void {
  const original = globalThis.crypto?.getRandomValues;
  // jsdom registers a crypto object; we mutate the property rather than
  // overwrite the whole object to keep other globals intact.
  Object.defineProperty(globalThis.crypto, "getRandomValues", {
    configurable: true,
    writable: true,
    value: (buf: Uint32Array) => {
      buf[0] = value >>> 0;
      return buf;
    },
  });
  return () => {
    if (original !== undefined) {
      Object.defineProperty(globalThis.crypto, "getRandomValues", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  };
}

/**
 * Match the production `pickWeightedIndex` semantics: the uint32 is
 * normalised to [0,1) and used as a target across the cumulative weight
 * range. We aim a value at the *centre* of slice `i`'s share. With 3
 * equal-weight slices and target = (i + 0.5) / 3, the picker lands on i.
 */
function uint32ForCenterOfSlice(i: number, count: number): number {
  const ratio = (i + 0.5) / count;
  return Math.floor(ratio * 0x1_00_00_00_00);
}

const TEST_REWARDS = [
  {
    label: "10 coins",
    reward: { kind: "currency" as const, currency: "coin", amount: 10 },
  },
  { label: "Badge", reward: { kind: "badge" as const, badgeId: "winner" } },
  {
    label: "Item",
    reward: { kind: "item" as const, itemId: "gem", quantity: 1 },
  },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe("pickWeightedIndex (internal helper)", () => {
  it("returns 0 when total weight is zero", () => {
    expect(pickWeightedIndex([0, 0, 0])).toBe(0);
  });

  it("scans cumulative weights deterministically with a fixed RNG", () => {
    // For weights [1,1,1] and rng→0.5*4_294_967_296, target=0.5*3=1.5
    // which lands in slice 1 (cumulative 1..2).
    const restore = stubGetRandomValues(0x80_00_00_00); // exactly 0.5
    try {
      expect(pickWeightedIndex([1, 1, 1])).toBe(1);
    } finally {
      restore();
    }
  });
});

describe("spinWheel — rendering", () => {
  it("renders the spin button and one slice per reward", () => {
    render(
      <SpinWheel
        rewards={TEST_REWARDS}
        cooldownMs={60_000}
        id="test-render"
        onSpin={() => {}}
      />,
    );
    // Three slices, three text labels.
    expect(screen.getByText("10 coins")).toBeInTheDocument();
    expect(screen.getByText("Badge")).toBeInTheDocument();
    expect(screen.getByText("Item")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /spin the wheel/i }),
    ).toBeInTheDocument();
  });
});

describe("spinWheel — spin lifecycle", () => {
  it("fires onSpin after transitionend with the correct reward", () => {
    const restore = stubGetRandomValues(uint32ForCenterOfSlice(1, 3));
    const onSpin = jest.fn();
    try {
      render(
        <SpinWheel
          rewards={TEST_REWARDS}
          cooldownMs={60_000}
          id="test-spin"
          onSpin={onSpin}
        />,
      );
      const btn = screen.getByRole("button", { name: /spin the wheel/i });
      act(() => {
        fireEvent.click(btn);
      });
      // Before transitionend, onSpin hasn't fired yet.
      expect(onSpin).not.toHaveBeenCalled();
      // Manually trigger the transitionend on the rotor group.
      const rotor = screen.getByTestId("qk-spinwheel-rotor");
      act(() => {
        fireTransformTransitionEnd(rotor);
      });
      expect(onSpin).toHaveBeenCalledTimes(1);
      expect(onSpin).toHaveBeenCalledWith(TEST_REWARDS[1]?.reward);
    } finally {
      restore();
    }
  });

  it("stamps localStorage[qk-spin-<id>] on spin", () => {
    const restore = stubGetRandomValues(uint32ForCenterOfSlice(0, 3));
    const before = Date.now();
    try {
      render(
        <SpinWheel
          rewards={TEST_REWARDS}
          cooldownMs={60_000}
          id="stamp-test"
          onSpin={() => {}}
        />,
      );
      act(() => {
        fireEvent.click(screen.getByRole("button"));
      });
      act(() => {
        fireTransformTransitionEnd(screen.getByTestId("qk-spinwheel-rotor"));
      });
      const raw = window.localStorage.getItem("qk-spin-stamp-test");
      expect(raw).not.toBeNull();
      const stamped = Number(raw);
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    } finally {
      restore();
    }
  });

  it("ignores transitionend events for non-transform properties", () => {
    const restore = stubGetRandomValues(uint32ForCenterOfSlice(0, 3));
    const onSpin = jest.fn();
    try {
      render(
        <SpinWheel
          rewards={TEST_REWARDS}
          cooldownMs={60_000}
          id="non-transform"
          onSpin={onSpin}
        />,
      );
      act(() => {
        fireEvent.click(screen.getByRole("button"));
      });
      // Fire transitionend with the wrong propertyName — should be ignored.
      act(() => {
        const ev = new Event("transitionend", { bubbles: true });
        Object.defineProperty(ev, "propertyName", { value: "opacity" });
        screen.getByTestId("qk-spinwheel-rotor").dispatchEvent(ev);
      });
      expect(onSpin).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("spinWheel — cooldown", () => {
  it("disables the spin button and shows countdown text when in cooldown", () => {
    // Seed localStorage with a recent spin so the cooldown is active.
    window.localStorage.setItem("qk-spin-cd-test", String(Date.now() - 1000));
    render(
      <SpinWheel
        rewards={TEST_REWARDS}
        cooldownMs={60_000}
        id="cd-test"
        onSpin={() => {}}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    // The button text contains "Next spin in"
    expect(btn).toHaveTextContent(/next spin in/i);
  });

  it("button is enabled once the cooldown has elapsed", () => {
    window.localStorage.setItem(
      "qk-spin-elapsed",
      String(Date.now() - 120_000),
    );
    render(
      <SpinWheel
        rewards={TEST_REWARDS}
        cooldownMs={60_000}
        id="elapsed"
        onSpin={() => {}}
      />,
    );
    expect(screen.getByRole("button")).not.toBeDisabled();
  });
});

describe("spinWheel — reduced motion", () => {
  it("fires onSpin synchronously without a transitionend when prefers-reduced-motion is set", () => {
    // Mock matchMedia to claim reduced-motion preference.
    const original = window.matchMedia;
    window.matchMedia = jest.fn().mockImplementation((q: string) => ({
      matches: q.includes("prefers-reduced-motion"),
      media: q,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })) as unknown as typeof window.matchMedia;

    const restore = stubGetRandomValues(uint32ForCenterOfSlice(2, 3));
    const onSpin = jest.fn();
    try {
      render(
        <SpinWheel
          rewards={TEST_REWARDS}
          cooldownMs={60_000}
          id="rm"
          onSpin={onSpin}
        />,
      );
      act(() => {
        fireEvent.click(screen.getByRole("button"));
      });
      // No transitionend needed.
      expect(onSpin).toHaveBeenCalledTimes(1);
      expect(onSpin).toHaveBeenCalledWith(TEST_REWARDS[2]?.reward);
    } finally {
      restore();
      window.matchMedia = original;
    }
  });
});
