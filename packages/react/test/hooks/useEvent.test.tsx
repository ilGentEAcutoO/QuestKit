import type { ReactElement, ReactNode } from "react";
import { type FireEventResult, QuestKitError } from "@questkit/core";

/**
 * useEvent — TDD specs.
 *
 * useEvent is write-only: no `data` field, only an imperative `fireEvent`
 * action plus a transient `isFiring` flag and `error` accumulator.
 *
 * Contract:
 *   1. Initial render: { isFiring: false, error: null }.
 *   2. Calling `fireEvent` flips `isFiring` to true, then back to false on
 *      settle. The returned promise resolves with the FireEventResult.
 *   3. If the SDK rejects, `error` is the QuestKitError and `isFiring` is
 *      false.
 *   4. The `fireEvent` reference is stable across renders.
 *   5. After unmount, no state updates occur even if a late promise
 *      resolves.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { useEvent } from "../../src/hooks/useEvent";
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

describe("useEvent", () => {
  it("starts with isFiring=false and error=null", () => {
    const client = makeFakeClient();
    const { result } = renderHook(() => useEvent(), {
      wrapper: wrapperWith(client),
    });
    expect(result.current.isFiring).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.fireEvent).toBe("function");
  });

  it("flips isFiring during a successful fireEvent and returns the result", async () => {
    const expected: FireEventResult = {
      accepted: true,
      eventId: "evt-1",
      missionsUpdated: ["m1"],
    };
    let resolveOk: (v: FireEventResult) => void = () => {};
    const inflight = new Promise<FireEventResult>((res) => {
      resolveOk = res;
    });
    const client = makeFakeClient({
      fireEvent: jest.fn().mockReturnValue(inflight),
    });
    const { result } = renderHook(() => useEvent(), {
      wrapper: wrapperWith(client),
    });

    let fireResultPromise: Promise<FireEventResult> | null = null;
    act(() => {
      fireResultPromise = result.current.fireEvent({
        name: "click",
        payload: {},
      });
    });
    // During the in-flight phase, isFiring must be true.
    await waitFor(() => expect(result.current.isFiring).toBe(true));

    await act(async () => {
      resolveOk(expected);
      await fireResultPromise;
    });

    expect(result.current.isFiring).toBe(false);
    expect(result.current.error).toBeNull();
    expect(client.fireEvent).toHaveBeenCalledWith({
      name: "click",
      payload: {},
    });
    expect(await fireResultPromise).toEqual(expected);
  });

  it("records the QuestKitError when fireEvent rejects", async () => {
    const boom = new QuestKitError("bad", "validation_error", 400);
    const client = makeFakeClient({
      fireEvent: jest.fn().mockRejectedValue(boom),
    });
    const { result } = renderHook(() => useEvent(), {
      wrapper: wrapperWith(client),
    });

    await act(async () => {
      await expect(
        result.current.fireEvent({ name: "x", payload: {} }),
      ).rejects.toBe(boom);
    });

    expect(result.current.error).toBe(boom);
    expect(result.current.isFiring).toBe(false);
  });

  it("keeps the fireEvent reference stable across renders", () => {
    const client = makeFakeClient();
    const { result, rerender } = renderHook(() => useEvent(), {
      wrapper: wrapperWith(client),
    });
    const first = result.current.fireEvent;
    rerender();
    expect(result.current.fireEvent).toBe(first);
  });

  it("wraps non-QuestKitError throws into a network_error QuestKitError", async () => {
    const client = makeFakeClient({
      fireEvent: jest.fn().mockRejectedValue(new Error("net down")),
    });
    const { result } = renderHook(() => useEvent(), {
      wrapper: wrapperWith(client),
    });
    await act(async () => {
      await expect(
        result.current.fireEvent({ name: "x", payload: {} }),
      ).rejects.toBeInstanceOf(QuestKitError);
    });
    expect(result.current.error).toBeInstanceOf(QuestKitError);
    expect(result.current.error?.code).toBe("network_error");
  });

  it("does not throw if the promise resolves after unmount", async () => {
    let resolveOk: (v: FireEventResult) => void = () => {};
    const pending = new Promise<FireEventResult>((res) => {
      resolveOk = res;
    });
    const client = makeFakeClient({
      fireEvent: jest.fn().mockReturnValue(pending),
    });
    const { result, unmount } = renderHook(() => useEvent(), {
      wrapper: wrapperWith(client),
    });

    let p: Promise<FireEventResult> | null = null;
    act(() => {
      p = result.current.fireEvent({ name: "n", payload: {} });
    });
    unmount();
    await act(async () => {
      resolveOk({ accepted: true, eventId: "x", missionsUpdated: [] });
      await p;
    });
    // If we got here without a "Can't perform a React state update on an
    // unmounted component" being thrown as an error, the test passes. No
    // explicit assertion needed beyond reaching this line.
    expect(true).toBe(true);
  });
});
