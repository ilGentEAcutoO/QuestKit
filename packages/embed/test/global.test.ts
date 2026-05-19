/**
 * global.ts — `window.QuestKit` imperative API.
 *
 *  - Delegates fireEvent / claim / getBalance / subscribe to the SDK.
 *  - Swallows SDK errors via console.warn (no host-page crash).
 *  - mount() scans + mounts; unmount(el) tears one down; unmount() tears all.
 */
import type { QuestKitClient } from "@questkit/core";

import { buildGlobal } from "../src/global";

interface FakeClient {
  fireEvent: jest.Mock;
  claimMission: jest.Mock;
  getBalance: jest.Mock;
  subscribe: jest.Mock;
  getMissions: jest.Mock;
}

function makeFake(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    fireEvent: jest.fn().mockResolvedValue({
      accepted: true,
      eventId: "e1",
      missionsUpdated: [],
    }),
    claimMission: jest.fn().mockResolvedValue({
      progress: {},
      balance: null,
      reward: { kind: "currency", currency: "GOLD", amount: 1 },
    }),
    getBalance: jest.fn().mockResolvedValue({
      userId: "u",
      currency: "GOLD",
      amount: 0,
      updatedAt: 0,
    }),
    subscribe: jest.fn().mockReturnValue(() => {}),
    getMissions: jest.fn().mockResolvedValue({ missions: [], progress: {} }),
    ...overrides,
  };
}

describe("buildGlobal", () => {
  beforeEach(() => {
    while (document.body.firstChild !== null) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  it("exposes the documented method surface", () => {
    const fake = makeFake();
    const g = buildGlobal(fake as unknown as QuestKitClient);
    expect(typeof g.fireEvent).toBe("function");
    expect(typeof g.claim).toBe("function");
    expect(typeof g.getBalance).toBe("function");
    expect(typeof g.mount).toBe("function");
    expect(typeof g.unmount).toBe("function");
    expect(typeof g.on).toBe("function");
    expect(typeof g.off).toBe("function");
    expect(g._client).toBe(fake);
  });

  it("forwards fireEvent to the SDK", async () => {
    const fake = makeFake();
    const g = buildGlobal(fake as unknown as QuestKitClient);
    await g.fireEvent("video.watched", { id: 7 });
    expect(fake.fireEvent).toHaveBeenCalledWith({
      name: "video.watched",
      payload: { id: 7 },
    });
  });

  it("swallows fireEvent errors via console.warn", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const fake = makeFake({
      fireEvent: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const g = buildGlobal(fake as unknown as QuestKitClient);
    await expect(g.fireEvent("x")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("claim() forwards to claimMission and swallows errors", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const fake = makeFake({
      claimMission: jest.fn().mockRejectedValue(new Error("nope")),
    });
    const g = buildGlobal(fake as unknown as QuestKitClient);
    await g.claim("m1");
    expect(fake.claimMission).toHaveBeenCalledWith("m1");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("getBalance returns null on SDK error", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const fake = makeFake({
      getBalance: jest.fn().mockRejectedValue(new Error("rate limited")),
    });
    const g = buildGlobal(fake as unknown as QuestKitClient);
    await expect(g.getBalance("GOLD")).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("on() subscribes, off() unsubscribes", () => {
    const unsubscribe = jest.fn();
    const fake = makeFake({
      subscribe: jest.fn().mockReturnValue(unsubscribe),
    });
    const g = buildGlobal(fake as unknown as QuestKitClient);
    const listener = jest.fn();
    g.on(listener);
    expect(fake.subscribe).toHaveBeenCalledWith(listener);
    g.off(listener);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // Calling off again is a no-op.
    g.off(listener);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("on() registers each listener at most once", () => {
    const fake = makeFake();
    const g = buildGlobal(fake as unknown as QuestKitClient);
    const listener = jest.fn();
    g.on(listener);
    g.on(listener);
    expect(fake.subscribe).toHaveBeenCalledTimes(1);
  });

  it("unmount() without args tears down all mounted widgets", () => {
    // Create an unknown widget that mount() will skip — we exercise the
    // path that records nothing; then unmount() without args must not throw.
    const fake = makeFake();
    const g = buildGlobal(fake as unknown as QuestKitClient);
    expect(() => g.unmount()).not.toThrow();
  });
});
