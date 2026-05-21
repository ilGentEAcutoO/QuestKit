/**
 * useMissionClaim — claim error-path spec (TASK-010 / F1 hotfix v0.1.9).
 *
 * Locks the wiring that surfaces a silent 409 `claim_not_ready` (the F1
 * regression from the Phase 9 walkthrough) as a toast + refetch instead
 * of a console.warn-only swallow. The root cause was server-side (KV
 * idempotency replay returned stale `missionsUpdated`); the demo side
 * provides belt-and-suspenders so any future regression that produces a
 * 409 on claim still gives the user feedback and converges the UI back
 * to authoritative state.
 *
 * Scope:
 *   1. 409 / claim_not_ready → showToast called with {kind:"error", …}
 *      AND onClaimed awaited (regardless of which surfaces it).
 *   2. Non-409 errors (e.g. 500) → neither toast nor refetch fires
 *      (regression guard so we don't accidentally widen the catch).
 *
 * Setup mirrors Layout.test.tsx — minimal fake QuestKitClient wrapped in
 * QuestKitProvider plus a wrapping DemoToastProvider so useDemoToast
 * resolves. We spy on the provider's `show` via mocking the module so we
 * can assert payloads without coupling to the host's render tree.
 */
import type { QuestKitClient } from "@questkit/core";
import type { SDKUpdate } from "@questkit/types";
import type { ReactNode } from "react";

import type { DemoToastInput } from "../components/DemoToastHost";
import { QuestKitError } from "@questkit/core";
import { QuestKitProvider } from "@questkit/react";

import { act, renderHook, waitFor } from "@testing-library/react";

import { DemoToastProvider } from "../components/DemoToastHost";
import { useMissionClaim } from "./useMissionClaim";

// Spy on the demo toast surface — we wrap useDemoToast so that every
// caller (including useMissionClaim under test) gets a `show` that
// records the input for later assertion. Keeps the real
// DemoToastProvider mounted for the provider contract check.
const showSpy = jest.fn<void, [DemoToastInput]>();
jest.mock("../components/DemoToastHost", () => {
  const actual = jest.requireActual("../components/DemoToastHost");
  return {
    ...actual,
    useDemoToast: (): { show: (input: DemoToastInput) => void } => ({
      show: showSpy,
    }),
  };
});

function makeFakeClient(
  claimImpl: (id: string) => Promise<never> | Promise<unknown>,
): QuestKitClient {
  const fake = {
    claimMission: jest.fn().mockImplementation(claimImpl),
    subscribe: jest.fn().mockImplementation((_cb: (u: SDKUpdate) => void) => {
      return () => {};
    }),
    onFireEventSuccess: jest.fn().mockReturnValue(() => {}),
    destroy: jest.fn(),
  };
  return fake as unknown as QuestKitClient;
}

function makeWrapper(
  client: QuestKitClient,
): (props: { children: ReactNode }) => ReactNode {
  return ({ children }): ReactNode => (
    <QuestKitProvider client={client}>
      <DemoToastProvider>{children}</DemoToastProvider>
    </QuestKitProvider>
  );
}

describe("useMissionClaim — error path (F1 hotfix v0.1.9)", () => {
  beforeEach(() => {
    showSpy.mockClear();
  });

  it("surfaces a 409 claim_not_ready as a toast AND refetches", async () => {
    const client = makeFakeClient(() => {
      // Server side returns 409 with code "claim_not_ready" — see
      // workers/api/src/routes/missions.ts on the not-ready path.
      throw new QuestKitError(
        "mission not ready to claim",
        "claim_not_ready",
        409,
      );
    });
    const onClaimed = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMissionClaim({ onClaimed }), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current("mission_abc");
    });

    // Toast assertion — must be the {kind:"error"} variant the
    // DemoToastHost refactor added. Title + description are part of the
    // contract because the host renders the description as a second line.
    await waitFor(() => {
      expect(showSpy).toHaveBeenCalledTimes(1);
    });
    const toastInput = showSpy.mock.calls[0]?.[0];
    expect(toastInput?.kind).toBe("error");
    if (toastInput?.kind === "error") {
      expect(toastInput.title.length).toBeGreaterThan(0);
    }

    // Refetch assertion — onClaimed MUST run so the UI converges back to
    // authoritative state. The optimistic counter was wrong (that's why
    // the server replied 409); without the refetch the claim button
    // would stay enabled and the user would just re-trigger the 409.
    expect(onClaimed).toHaveBeenCalledTimes(1);
  });

  it("does NOT toast or refetch on non-409 errors (regression guard)", async () => {
    const client = makeFakeClient(() => {
      // 500 / server_error — generic backend failure, NOT the F1 path.
      // We don't want the catch to widen — those errors land in the SDK
      // EventLog via the QuestKitError throw and the MissionCard's own
      // finally clears its "Claiming…" state.
      throw new QuestKitError("server crashed", "server_error", 500);
    });
    const onClaimed = jest.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMissionClaim({ onClaimed }), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current("mission_xyz");
    });

    expect(showSpy).not.toHaveBeenCalled();
    expect(onClaimed).not.toHaveBeenCalled();
  });
});
