/**
 * Layout — footer version + multi-currency balance specs.
 *
 * The footer test (TASK-004 / D5) locks the version wiring: the footer
 * string MUST contain `v${pkg.version}` for whatever version package.json
 * currently declares — if someone hardcodes the footer back to a literal
 * "v0.1.X", this test fails the next time the version bumps.
 *
 * The balance-pill tests (TASK-014 / F5-b) lock the multi-currency
 * header: all three demo currencies (coin / gem / point) must render
 * — even at zero — so users discover that gem-/point-rewarding
 * missions actually credit something visible. The aria-label must
 * mention all three currencies for screen-reader users.
 *
 * Implementation notes for the test setup:
 *   - The QuestKit demo's Layout uses `useBalance()` (list mode) for the
 *     header pulse animation and `useLocation` for route-change
 *     transitions, so it needs both a `QuestKitProvider` (with a mock
 *     client) and a `MemoryRouter` wrapping a route that resolves to
 *     `<Layout />`.
 *   - We mock `framer-motion` minimally so jsdom doesn't error on the
 *     useReducedMotion call chain.
 */
import type { QuestKitClient } from "@questkit/core";
import type { Balance, SDKUpdate } from "@questkit/types";

import { QuestKitProvider } from "@questkit/react";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import pkg from "../../../../package.json";
import { Layout } from "./Layout";

/**
 * Minimal duck-typed stand-in for QuestKitClient. The Layout only ever
 * calls `getBalances` (via useBalance() list mode) and `subscribe`
 * (also via useBalance for SSE). Everything else is stubbed to satisfy
 * the type shape but throws if accidentally invoked.
 *
 * `balances` lets each test tailor what the server "has" for the user.
 * The default is one coin row at 0 so the existing footer tests don't
 * accidentally exercise the new multi-currency branch.
 */
function makeFakeClient(balances?: Balance[]): QuestKitClient {
  const coinBalance: Balance = {
    userId: "u_test",
    currency: "coin",
    amount: 0,
    updatedAt: 1,
  };
  const list = balances ?? [coinBalance];
  const single = list[0] ?? coinBalance;
  const fake = {
    getBalance: jest.fn().mockResolvedValue(single),
    getBalances: jest.fn().mockResolvedValue(list),
    subscribe: jest.fn().mockImplementation((_cb: (u: SDKUpdate) => void) => {
      return () => {};
    }),
    onFireEventSuccess: jest.fn().mockReturnValue(() => {}),
    destroy: jest.fn(),
  };
  return fake as unknown as QuestKitClient;
}

function renderLayout(balances?: Balance[]): ReturnType<typeof render> {
  const client = makeFakeClient(balances);
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

describe("layout header balance — multi-currency (TASK-014 / F5-b)", () => {
  it("renders ALL three demo currencies (coin/gem/point) even when server has only coin", async () => {
    // Server returns only the coin row. The pill must still surface gem
    // and point at zero so a user who hasn't yet claimed Variety Pack
    // (gem) or Deep Diver (point) discovers those currencies exist.
    renderLayout([
      {
        userId: "u_test",
        currency: "coin",
        amount: 0,
        updatedAt: 1,
      },
    ]);
    await act(async () => {
      await Promise.resolve();
    });

    const status = screen.getByRole("status");
    // Each currency chip carries a data-currency attribute — the
    // assertions thread the needle without depending on visual order
    // (sort key lives in the component but the test only cares that
    // all three are present).
    const coin = status.querySelector('[data-currency="coin"]');
    const gem = status.querySelector('[data-currency="gem"]');
    const point = status.querySelector('[data-currency="point"]');
    expect(coin).not.toBeNull();
    expect(gem).not.toBeNull();
    expect(point).not.toBeNull();

    // The visual labels confirm the user-facing copy contains each
    // currency name — protects against accidental glyph-only renders.
    expect(within(status).getByText("coin")).toBeInTheDocument();
    expect(within(status).getByText("gem")).toBeInTheDocument();
    expect(within(status).getByText("point")).toBeInTheDocument();
  });

  it("reflects server-returned amounts for each currency", async () => {
    renderLayout([
      { userId: "u_test", currency: "coin", amount: 120, updatedAt: 1 },
      { userId: "u_test", currency: "gem", amount: 5, updatedAt: 2 },
      { userId: "u_test", currency: "point", amount: 500, updatedAt: 3 },
    ]);
    await act(async () => {
      await Promise.resolve();
    });

    const status = screen.getByRole("status");
    const coin = status.querySelector('[data-currency="coin"]');
    const gem = status.querySelector('[data-currency="gem"]');
    const point = status.querySelector('[data-currency="point"]');
    expect(coin?.textContent ?? "").toContain("120");
    expect(gem?.textContent ?? "").toContain("5");
    expect(point?.textContent ?? "").toContain("500");
  });

  it("aria-label mentions all three currencies for screen readers", async () => {
    renderLayout([
      { userId: "u_test", currency: "coin", amount: 7, updatedAt: 1 },
      { userId: "u_test", currency: "gem", amount: 2, updatedAt: 2 },
    ]);
    await act(async () => {
      await Promise.resolve();
    });

    const status = screen.getByRole("status");
    const label = status.getAttribute("aria-label") ?? "";
    // The label must announce all three currencies + amounts. We don't
    // pin the exact phrasing — only that each currency name and its
    // amount appear together so a screen-reader user can build a mental
    // model of their wallet.
    expect(label).toMatch(/7 coin/);
    expect(label).toMatch(/2 gem/);
    expect(label).toMatch(/0 point/);
  });
});
