import type { Balance, SDKUpdate } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";

import { QuestKitError } from "@questkit/core";
/**
 * useBalance — TDD specs.
 *
 * Behaviour contract (matches §6.3 of plan.md):
 *   1. Initial render returns the loading state.
 *   2. After client.getBalance() resolves, `data` reflects the response and
 *      `isSuccess` is true.
 *   3. When the client rejects, `error` carries the QuestKitError and
 *      `isError` is true.
 *   4. A `balance.changed` SSE update for the same currency reactively
 *      replaces `data`.
 *   5. Unmount calls the unsubscribe returned by `client.subscribe`.
 *   6. With no `currency` arg, the hook falls back to `getBalances()` and
 *      `data` is an array.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

import { useBalance } from "../../src/hooks/useBalance";
import { QuestKitProvider } from "../../src/provider";
import { type FakeClient, makeFakeClient } from "./test-utils";

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

const goldBalance: Balance = {
  userId: "u1",
  currency: "GOLD",
  amount: 100,
  updatedAt: 1_700_000_000,
};

describe("useBalance", () => {
  it("returns loading state on first render", () => {
    const client = makeFakeClient({
      getBalance: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const { result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("populates data after fetch resolves", async () => {
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(goldBalance),
    });
    const { result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.data).toEqual(goldBalance);
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.isError).toBe(false);
    expect(result.current.error).toBeNull();
    expect(client.getBalance).toHaveBeenCalledWith("GOLD");
  });

  it("captures errors and exposes them via `error`", async () => {
    const boom = new QuestKitError("nope", "server_error", 500);
    const client = makeFakeClient({
      getBalance: jest.fn().mockRejectedValue(boom),
    });
    const { result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.error).toBe(boom);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isSuccess).toBe(false);
  });

  it("reacts to balance.changed SSE updates for the same currency", async () => {
    let pushUpdate: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(goldBalance),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        pushUpdate = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const updated: Balance = { ...goldBalance, amount: 250 };
    act(() => {
      pushUpdate?.({ type: "balance.changed", data: updated });
    });

    expect(result.current.data).toEqual(updated);
  });

  it("ignores balance.changed updates for a different currency", async () => {
    let pushUpdate: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(goldBalance),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        pushUpdate = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const other: Balance = {
      userId: "u1",
      currency: "GEM",
      amount: 7,
      updatedAt: 1,
    };
    act(() => {
      pushUpdate?.({ type: "balance.changed", data: other });
    });

    expect(result.current.data).toEqual(goldBalance);
  });

  it("calls unsubscribe on unmount", async () => {
    const unsubscribe = jest.fn();
    const client = makeFakeClient({
      getBalance: jest.fn().mockResolvedValue(goldBalance),
      subscribe: jest.fn().mockReturnValue(unsubscribe),
    });
    const { unmount, result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("falls back to getBalances() when no currency is given", async () => {
    const all: Balance[] = [goldBalance];
    const client = makeFakeClient({
      getBalances: jest.fn().mockResolvedValue(all),
    });
    const { result } = renderHook(() => useBalance(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(all);
    expect(client.getBalances).toHaveBeenCalledTimes(1);
  });

  it("list mode: SSE update REPLACES an existing currency row", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const initial: Balance[] = [goldBalance];
    const client = makeFakeClient({
      getBalances: jest.fn().mockResolvedValue(initial),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useBalance(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const updated: Balance = { ...goldBalance, amount: 500 };
    act(() => {
      push?.({ type: "balance.changed", data: updated });
    });
    expect(result.current.data).toEqual([updated]);
  });

  it("list mode: SSE update INSERTS a new currency row", async () => {
    let push: ((u: SDKUpdate) => void) | null = null;
    const client = makeFakeClient({
      getBalances: jest.fn().mockResolvedValue([goldBalance]),
      subscribe: jest.fn().mockImplementation((cb: (u: SDKUpdate) => void) => {
        push = cb;
        return jest.fn();
      }),
    });
    const { result } = renderHook(() => useBalance(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const gem: Balance = {
      userId: "u1",
      currency: "GEM",
      amount: 3,
      updatedAt: 2,
    };
    act(() => {
      push?.({ type: "balance.changed", data: gem });
    });
    expect(result.current.data).toEqual([goldBalance, gem]);
  });

  it("wraps non-QuestKitError throws into a network_error QuestKitError", async () => {
    const client = makeFakeClient({
      getBalance: jest.fn().mockRejectedValue(new Error("boom-string")),
    });
    const { result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(QuestKitError);
    expect(result.current.error?.code).toBe("network_error");
    expect(result.current.error?.message).toContain("boom-string");
  });

  it("refetch() re-invokes the SDK and returns updated data", async () => {
    const first: Balance = { ...goldBalance, amount: 1 };
    const second: Balance = { ...goldBalance, amount: 99 };
    const getBalance = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const client = makeFakeClient({ getBalance });
    const { result } = renderHook(() => useBalance("GOLD"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.data).toEqual(first));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data).toEqual(second);
    expect(getBalance).toHaveBeenCalledTimes(2);
  });
});
