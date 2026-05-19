import type { Balance, MissionProgress, SDKUpdate } from "@questkit/types";
import { diffStates, PollingClient, type PollingState } from "../src/polling";

const baseProgress = (
  overrides: Partial<MissionProgress> = {},
): MissionProgress => ({
  userId: "u",
  missionId: "m1",
  status: "active",
  progress: 0.5,
  currentCount: 1,
  targetCount: 2,
  updatedAt: 0,
  ...overrides,
});

const baseBalance = (overrides: Partial<Balance> = {}): Balance => ({
  userId: "u",
  currency: "coin",
  amount: 0,
  updatedAt: 0,
  ...overrides,
});

describe("diffStates", () => {
  it("returns empty when both states are equal", () => {
    const a: PollingState = {
      progress: { m1: baseProgress() },
      balances: [baseBalance()],
    };
    const b: PollingState = {
      progress: { m1: baseProgress() },
      balances: [baseBalance()],
    };
    expect(diffStates(a, b)).toEqual([]);
  });

  it("emits mission.progress for changed progress rows", () => {
    const a: PollingState = {
      progress: { m1: baseProgress({ currentCount: 1 }) },
      balances: [],
    };
    const b: PollingState = {
      progress: { m1: baseProgress({ currentCount: 2 }) },
      balances: [],
    };
    const out = diffStates(a, b);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "mission.progress" });
  });

  it("emits mission.progress for new progress rows", () => {
    const a: PollingState = { progress: {}, balances: [] };
    const b: PollingState = {
      progress: { m1: baseProgress() },
      balances: [],
    };
    expect(diffStates(a, b)).toHaveLength(1);
  });

  it("ignores updatedAt-only changes", () => {
    const a: PollingState = {
      progress: { m1: baseProgress({ updatedAt: 1 }) },
      balances: [],
    };
    const b: PollingState = {
      progress: { m1: baseProgress({ updatedAt: 999 }) },
      balances: [],
    };
    expect(diffStates(a, b)).toEqual([]);
  });

  it("emits balance.changed for new currencies", () => {
    const a: PollingState = { progress: {}, balances: [] };
    const b: PollingState = {
      progress: {},
      balances: [baseBalance({ amount: 10 })],
    };
    const out = diffStates(a, b);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      type: "balance.changed",
      data: { amount: 10 },
    });
  });

  it("emits balance.changed only when amount differs", () => {
    const a: PollingState = {
      progress: {},
      balances: [baseBalance({ amount: 5 })],
    };
    const b: PollingState = {
      progress: {},
      balances: [baseBalance({ amount: 5, updatedAt: 999 })],
    };
    expect(diffStates(a, b)).toEqual([]);

    const c: PollingState = {
      progress: {},
      balances: [baseBalance({ amount: 7 })],
    };
    expect(diffStates(a, c)).toHaveLength(1);
  });
});

describe("pollingClient", () => {
  it("does not emit on the first poll (establishes baseline)", async () => {
    const emit = jest.fn();
    const client = new PollingClient({
      intervalMs: 10,
      fetchState: async () => ({
        progress: { m1: baseProgress() },
        balances: [],
      }),
      onChange: emit,
    });
    await client.pollNow();
    expect(emit).not.toHaveBeenCalled();
  });

  it("emits diffs on subsequent polls", async () => {
    let amount = 1;
    const emit = jest.fn();
    const client = new PollingClient({
      intervalMs: 10,
      fetchState: async () => ({
        progress: {},
        balances: [baseBalance({ amount: amount++ })],
      }),
      onChange: emit,
    });
    await client.pollNow();
    await client.pollNow();
    expect(emit).toHaveBeenCalledTimes(1);
    const updates = emit.mock.calls[0]?.[0] as SDKUpdate[] | undefined;
    expect(updates?.[0]?.type).toBe("balance.changed");
  });

  it("ticks on start at the configured interval", async () => {
    const calls: number[] = [];
    let amount = 0;
    const setIntervalImpl = jest
      .fn()
      .mockImplementation((cb: () => void, _ms: number) => {
        // Synchronously invoke cb twice to simulate two ticks.
        void Promise.resolve().then(() => {
          cb();
          calls.push(1);
        });
        void Promise.resolve().then(() => {
          cb();
          calls.push(2);
        });
        return 42 as unknown as ReturnType<typeof setInterval>;
      });
    const clearIntervalImpl = jest.fn();
    const emit = jest.fn();
    const client = new PollingClient({
      intervalMs: 1,
      fetchState: async () => ({
        progress: {},
        balances: [baseBalance({ amount: amount++ })],
      }),
      onChange: emit,
      setIntervalImpl:
        setIntervalImpl as unknown as PollingClient["start"] extends () => void
          ? (cb: () => void, ms: number) => ReturnType<typeof setInterval>
          : never,
      clearIntervalImpl: clearIntervalImpl as unknown as (
        id: ReturnType<typeof setInterval>,
      ) => void,
    });
    client.start();
    // Allow microtasks
    await new Promise((res) => setTimeout(res, 5));
    expect(setIntervalImpl).toHaveBeenCalledTimes(1);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    client.stop();
    expect(clearIntervalImpl).toHaveBeenCalled();
  });

  it("start is idempotent — second call has no effect", () => {
    const setIntervalImpl = jest
      .fn()
      .mockReturnValue(42 as unknown as ReturnType<typeof setInterval>);
    const client = new PollingClient({
      fetchState: async () => ({ progress: {}, balances: [] }),
      onChange: () => undefined,
      setIntervalImpl: setIntervalImpl as unknown as (
        cb: () => void,
        ms: number,
      ) => ReturnType<typeof setInterval>,
      clearIntervalImpl: jest.fn() as unknown as (
        id: ReturnType<typeof setInterval>,
      ) => void,
    });
    client.start();
    client.start();
    expect(setIntervalImpl).toHaveBeenCalledTimes(1);
    client.stop();
  });

  it("stop clears the baseline so a re-start polls fresh", async () => {
    let state: PollingState = {
      progress: {},
      balances: [baseBalance({ amount: 1 })],
    };
    const emit = jest.fn();
    const client = new PollingClient({
      fetchState: async () => state,
      onChange: emit,
    });
    await client.pollNow();
    state = { progress: {}, balances: [baseBalance({ amount: 2 })] };
    await client.pollNow();
    // After stop, prev is cleared — next poll re-baselines
    client.stop();
    state = { progress: {}, balances: [baseBalance({ amount: 99 })] };
    await client.pollNow();
    // emit called only on the first transition (1→2), not on the post-stop poll
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("routes fetcher errors to onError", async () => {
    const errors: Error[] = [];
    const client = new PollingClient({
      fetchState: async () => {
        throw new Error("boom");
      },
      onChange: () => undefined,
      onError: (e) => errors.push(e),
    });
    await client.pollNow();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("boom");
  });

  it("re-entrant pollNow is a no-op while a poll is in-flight", async () => {
    let resolveFetch!: (s: PollingState) => void;
    const fetchState = jest
      .fn()
      .mockImplementation(
        () => new Promise<PollingState>((res) => (resolveFetch = res)),
      );
    const client = new PollingClient({
      fetchState,
      onChange: () => undefined,
    });
    const p1 = client.pollNow();
    const p2 = client.pollNow();
    resolveFetch({ progress: {}, balances: [] });
    await Promise.all([p1, p2]);
    expect(fetchState).toHaveBeenCalledTimes(1);
  });
});
