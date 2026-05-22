/**
 * DemoToastHost — variant rendering specs.
 *
 * The host renders three discriminated-union variants of `DemoToastInput`:
 *   - `Reward` (badge / currency / item) — warm-gold celebratory chip
 *   - `DemoToastError` — red warning chip (F1 hotfix v0.1.9)
 *   - `DemoToastProgress` — neutral grey-blue progress chip
 *     (F7-a hotfix v0.1.15)
 *
 * The badge-grant and progress-nudge variants live close in semantic
 * space (both mention a badge) but must render differently — that was
 * the whole point of F7-a. These specs pin:
 *   1. The progress variant's user-facing copy is "+1 toward <label>",
 *      NOT the old "Badge: …" form. If anyone re-wires the per-spin /
 *      per-scratch toast back to the raw badge reward, the copy
 *      assertion below fails the next time the test runs.
 *   2. The badge-grant variant's user-facing copy is still "Badge: …"
 *      so the actual claim-success celebration is unaffected.
 *   3. The progress variant uses its distinct dismiss button aria-label
 *      so a screen-reader user can tell apart the two toast kinds even
 *      without the visual chip colour.
 */
import type { QuestKitClient } from "@questkit/core";
import type { SDKUpdate } from "@questkit/types";
import type { ReactElement } from "react";

import { QuestKitProvider } from "@questkit/react";
import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";

import {
  type DemoToastInput,
  DemoToastProvider,
  useDemoToast,
} from "./DemoToastHost";

/**
 * Minimal duck-typed QuestKitClient — DemoToastHost itself doesn't read
 * the client, but `useDemoToast` is exported alongside other hooks that
 * MAY hit it from sibling components. We mount the provider anyway so
 * the suite mirrors realistic app composition.
 */
function makeFakeClient(): QuestKitClient {
  const fake = {
    subscribe: jest.fn().mockImplementation((_cb: (u: SDKUpdate) => void) => {
      return () => {};
    }),
    onFireEventSuccess: jest.fn().mockReturnValue(() => {}),
    destroy: jest.fn(),
  };
  return fake as unknown as QuestKitClient;
}

/**
 * Helper component — calls `useDemoToast().show(input)` once on mount so
 * tests can `render(<Show input={…} />)` and immediately assert on the
 * host's rendered output. The imperative API is the real public surface
 * used by routes/* (e.g. minigames.tsx's onSpin / onReveal callbacks).
 */
function Show({ input }: { input: DemoToastInput }): ReactElement | null {
  const { show } = useDemoToast();
  useEffect(() => {
    show(input);
  }, [show, input]);
  return null;
}

function renderWithProvider(input: DemoToastInput): void {
  const client = makeFakeClient();
  render(
    <QuestKitProvider client={client}>
      <DemoToastProvider>
        <Show input={input} />
      </DemoToastProvider>
    </QuestKitProvider>,
  );
}

describe("demoToastHost — progress variant (F7-a / v0.1.15)", () => {
  it("renders progress nudge as '+1 toward <label>' NOT 'Badge: …'", async () => {
    renderWithProvider({
      kind: "progress",
      missionId: "mis_lucky_spinner",
      label: "Lucky Spinner badge",
    });

    // Drain the effect that calls show(input) so the host renders.
    await act(async () => {
      await Promise.resolve();
    });

    // The progress copy must be present — this is the F7-a fix.
    expect(
      screen.getByText("+1 toward Lucky Spinner badge"),
    ).toBeInTheDocument();

    // The pre-fix per-spin copy MUST NOT appear. If anyone re-wires the
    // per-spin toast back to `{kind:"badge", badgeId:"lucky_spinner"}`
    // the host would render "Badge: lucky_spinner" and this guard fires.
    expect(screen.queryByText(/^Badge: /)).toBeNull();
  });

  it("uses the 'Dismiss progress notice' aria-label on the close button", async () => {
    renderWithProvider({
      kind: "progress",
      missionId: "mis_scratch_master",
      label: "Scratch Master badge",
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Each variant has its own dismiss-button aria-label so a screen-
    // reader user can tell apart progress vs error vs reward without
    // needing to interpret the chip colour.
    const dismiss = screen.getByRole("button", {
      name: /dismiss progress notice/i,
    });
    expect(dismiss).toBeInTheDocument();
  });
});

describe("demoToastHost — badge-grant variant (claim success path unchanged)", () => {
  it("still renders 'Badge: <badgeId>' for the real claim-success path", async () => {
    // This is the variant fired by useMissionClaim on a 200 OK claim —
    // the actual badge GRANT. F7-a only fixed the misleading per-spin
    // wiring; the celebratory claim toast itself stayed put.
    renderWithProvider({
      kind: "badge",
      badgeId: "lucky_spinner",
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Badge: lucky_spinner")).toBeInTheDocument();
    expect(screen.queryByText("+1 toward Lucky Spinner badge")).toBeNull();

    // Reward variants use the generic "Dismiss reward" aria-label.
    expect(
      screen.getByRole("button", { name: /dismiss reward/i }),
    ).toBeInTheDocument();
  });
});
