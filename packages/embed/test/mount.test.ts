/**
 * mount.ts — Shadow DOM widget mounting.
 *
 *  - Attaches an open Shadow DOM to the host element.
 *  - Injects the QuestKit stylesheet.
 *  - Renders the named React component inside, wrapped in
 *    QuestKitProvider.
 *  - Returns an `unmount` handle.
 *  - Unknown widgets log a warning and return null (no throw).
 *
 * Notes:
 *   - We pass a duck-typed fake client to QuestKitProvider via the
 *     test-only `client` prop. The real QuestKitClient would try to open
 *     SSE / mint tokens, which jsdom can't run.
 *   - `act` from RTL flushes React effects so the MissionList's
 *     useMissions promise settles before we assert on the rendered text.
 */
import type { QuestKitClient } from "@questkit/core";
import type { WidgetDescriptor } from "../src/scan";

import { act } from "@testing-library/react";
import { mountWidget } from "../src/mount";

interface FakeClientShape {
  getMissions: jest.Mock;
  getMission: jest.Mock;
  getBalance: jest.Mock;
  getBalances: jest.Mock;
  getCampaign: jest.Mock;
  getCampaigns: jest.Mock;
  fireEvent: jest.Mock;
  getRecommendations: jest.Mock;
  getUserId: jest.Mock;
  subscribe: jest.Mock;
  destroy: jest.Mock;
  claimMission: jest.Mock;
}

function makeFake(): FakeClientShape {
  return {
    getMissions: jest.fn().mockResolvedValue({
      missions: [
        {
          id: "m1",
          title: "Open the demo",
          description: "Just open it.",
          criteria: { eventName: "page_view", count: 1 },
          reward: { kind: "currency", currency: "GOLD", amount: 5 },
        },
      ],
      progress: {
        m1: {
          userId: "u1",
          missionId: "m1",
          status: "active" as const,
          progress: 0,
          currentCount: 0,
          targetCount: 1,
          updatedAt: 1,
        },
      },
    }),
    getMission: jest.fn(),
    getBalance: jest.fn(),
    getBalances: jest.fn(),
    getCampaign: jest.fn(),
    getCampaigns: jest.fn(),
    fireEvent: jest.fn(),
    getRecommendations: jest.fn(),
    getUserId: jest.fn(),
    subscribe: jest.fn().mockReturnValue(() => {}),
    destroy: jest.fn(),
    claimMission: jest.fn(),
  };
}

function makeDescriptor(
  widget: string,
  parent: ParentNode = document.body,
): WidgetDescriptor {
  const el = document.createElement("div");
  el.setAttribute("data-questkit", widget);
  parent.appendChild(el);
  return { el, widget, props: {} };
}

describe("mountWidget", () => {
  beforeEach(() => {
    while (document.body.firstChild !== null) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("returns null and warns when the widget name is unknown", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const d = makeDescriptor("DefinitelyNotAWidget");
    const handle = mountWidget(d, {} as unknown as QuestKitClient);
    expect(handle).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown widget"),
    );
    warn.mockRestore();
  });

  it("attaches an open Shadow DOM and injects the embed stylesheet", async () => {
    const fake = makeFake();
    const d = makeDescriptor("MissionList");

    await act(async () => {
      const handle = mountWidget(d, fake as unknown as QuestKitClient);
      expect(handle).not.toBeNull();
      expect(handle!.shadowRoot).toBe(d.el.shadowRoot);
      expect(d.el.shadowRoot!.mode).toBe("open");
      // Stylesheet present
      const styleEl = d.el.shadowRoot!.querySelector("style");
      expect(styleEl).not.toBeNull();
      expect(styleEl!.textContent).toMatch(/--color-qk-primary/);
      // Mount point present
      expect(d.el.shadowRoot!.querySelector(".qk-embed-root")).not.toBeNull();
    });
  });

  it("renders MissionList content into the Shadow DOM", async () => {
    const fake = makeFake();
    const d = makeDescriptor("MissionList");

    let handle: ReturnType<typeof mountWidget> = null;
    await act(async () => {
      handle = mountWidget(d, fake as unknown as QuestKitClient);
    });
    expect(handle).not.toBeNull();

    // Let the useMissions promise resolve.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const text = d.el.shadowRoot!.textContent ?? "";
    expect(text).toContain("Open the demo");
  });

  it("unmount() tears the React tree down without throwing", async () => {
    const fake = makeFake();
    const d = makeDescriptor("MissionList");

    let handle: ReturnType<typeof mountWidget> = null;
    await act(async () => {
      handle = mountWidget(d, fake as unknown as QuestKitClient);
    });
    expect(handle).not.toBeNull();
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      handle!.unmount();
    });
    // Calling unmount twice is a no-op (idempotent).
    expect(() => handle!.unmount()).not.toThrow();
  });
});
