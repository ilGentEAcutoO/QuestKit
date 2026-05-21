/**
 * Layout — footer version specs (TASK-004 / D5).
 *
 * The footer text must read from the monorepo root package.json so future
 * version bumps (e.g. TASK-008 → 0.1.5) propagate without code edits. This
 * test locks the wiring: the footer string MUST contain `v${pkg.version}`
 * for whatever version package.json currently declares.
 *
 * If a future hand hardcodes the footer string back to a literal "v0.1.X",
 * this test will fail the next time the version bumps.
 *
 * Implementation notes for the test setup:
 *   - The QuestKit demo's Layout uses `useBalance("coin")` for the header
 *     pulse animation and `useLocation` for route-change transitions, so
 *     it needs both a `QuestKitProvider` (with a mock client) and a
 *     `MemoryRouter` wrapping a route that resolves to `<Layout />`.
 *   - We mock `framer-motion` minimally so jsdom doesn't error on the
 *     useReducedMotion call chain.
 */
import type { QuestKitClient } from "@questkit/core";
import type { Balance, SDKUpdate } from "@questkit/types";

import { QuestKitProvider } from "@questkit/react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import pkg from "../../../../package.json";
import { Layout } from "./Layout";

/**
 * Minimal duck-typed stand-in for QuestKitClient. The Layout only ever
 * calls `getBalance` (via useBalance) and `subscribe` (also via
 * useBalance for SSE). Everything else is stubbed to satisfy the type
 * shape but throws if accidentally invoked.
 */
function makeFakeClient(): QuestKitClient {
  const coinBalance: Balance = {
    userId: "u_test",
    currency: "coin",
    amount: 0,
    updatedAt: 1,
  };
  const fake = {
    getBalance: jest.fn().mockResolvedValue(coinBalance),
    getBalances: jest.fn().mockResolvedValue([coinBalance]),
    subscribe: jest.fn().mockImplementation((_cb: (u: SDKUpdate) => void) => {
      return () => {};
    }),
    onFireEventSuccess: jest.fn().mockReturnValue(() => {}),
    destroy: jest.fn(),
  };
  return fake as unknown as QuestKitClient;
}

function renderLayout(): ReturnType<typeof render> {
  const client = makeFakeClient();
  return render(
    <QuestKitProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<div>home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QuestKitProvider>,
  );
}

describe("layout footer", () => {
  it("renders the version from the monorepo root package.json", async () => {
    renderLayout();
    // Drain the useBalance fetch so React commits the balance state, but
    // the footer renders synchronously on first render — no waitFor needed.
    await act(async () => {
      await Promise.resolve();
    });
    const footer = screen.getByText(
      new RegExp(
        // Escape dots so 0.1.0 matches literally, not as wildcard.
        `QuestKit v${pkg.version.replace(/\./g, "\\.")}\\b`,
      ),
    );
    expect(footer).toBeInTheDocument();
  });

  it("does NOT contain a hardcoded older version string", async () => {
    renderLayout();
    await act(async () => {
      await Promise.resolve();
    });
    // Guard against regression: if someone hardcodes "v0.1.0" again, this
    // breaks once the root package.json is bumped past 0.1.0.
    const expected = `v${pkg.version}`;
    // Find the footer (a <footer> element); confirm its text contains the
    // dynamic version, not just any literal.
    const footers = document.querySelectorAll("footer");
    expect(footers.length).toBeGreaterThan(0);
    const text = Array.from(footers)
      .map((f) => f.textContent ?? "")
      .join(" ");
    expect(text).toContain(expected);
  });
});
