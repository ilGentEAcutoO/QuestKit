import type { ReactNode } from "react";
/**
 * QuestKitProvider — TDD specs for the test-shim path added in TASK-015.
 *
 * The production provider was scaffolded in TASK-014. These tests target
 * the new branches: the optional `client` injection, the `useQuestKit`
 * outside-provider guard, and the no-config no-client error path.
 */
import { render, renderHook } from "@testing-library/react";

import { QuestKitProvider, useQuestKit } from "../../src/provider";
import { makeFakeClient } from "./test-utils";

describe("questKitProvider", () => {
  it("throws if neither config nor client is given", () => {
    // Suppress React's console.error noise from the thrown error.
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      render(
        <QuestKitProvider>
          <span>x</span>
        </QuestKitProvider>,
      ),
    ).toThrow(/requires either `config` or `client`/);
    spy.mockRestore();
  });

  it("provides the injected client to descendants via useQuestKit()", () => {
    const fake = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QuestKitProvider
        client={
          fake as unknown as Parameters<typeof QuestKitProvider>[0]["client"]
        }
      >
        {children}
      </QuestKitProvider>
    );
    const { result } = renderHook(() => useQuestKit(), { wrapper });
    expect(result.current).toBe(fake);
  });

  it("does NOT call destroy() on unmount when an injected client is used", () => {
    const fake = makeFakeClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QuestKitProvider
        client={
          fake as unknown as Parameters<typeof QuestKitProvider>[0]["client"]
        }
      >
        {children}
      </QuestKitProvider>
    );
    const { unmount } = renderHook(() => useQuestKit(), { wrapper });
    unmount();
    expect(fake.destroy).not.toHaveBeenCalled();
  });

  it("useQuestKit throws when called outside a provider", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useQuestKit())).toThrow(
      /must be called inside a <QuestKitProvider>/,
    );
    spy.mockRestore();
  });
});
