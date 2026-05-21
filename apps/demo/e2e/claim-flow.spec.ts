/**
 * Claim flow E2E suite — Phase 9 / TASK-002 (Cluster C2 — B3/B4/D1).
 *
 * Verifies the post-claim UI converges to the SERVER-side claimed state
 * across all three demo routes, with NO client-side navigation. These
 * tests pin the contract introduced by TASK-001's mission.claimed SSE
 * event + useMissionClaim's refetch fallback, AND TASK-002's removal of
 * the local watchedToday / localStorage streak mirrors (which used to
 * diverge from server state and made the widgets stuck at the pre-claim
 * counter even after a successful claim).
 *
 * Three scenarios:
 *   1. /ecommerce — Buy ×3 → Claim → MissionCard flips to Claimed in <2s,
 *      coin balance widget increments, URL unchanged.
 *   2. /streaming — Watch 3 documentaries → Claim Curious Mind →
 *      "Today's progress" widget shows 3/3 + MissionCard shows Claimed,
 *      URL unchanged.
 *   3. /daily — Check in → Daily Visitor 1/1 + Claim → streak hero shows
 *      "Already checked in today" + claimed-style copy, URL unchanged.
 *
 * Per-spec isolation: every test calls resetDemoUser via the same path
 * the cross-cutting spec uses, so each scenario starts with a clean
 * demo_user_42 + zero MissionProgress rows.
 *
 * Console hygiene fixture (./fixtures.ts) auto-fails any test that logs
 * an error or warning outside the allowlist.
 */
import { expect, test } from "./_fixtures";
import { resetDemoUser } from "./_helpers";

test.describe("Claim flow — widgets reconcile to server-claimed state", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemoUser(page);
  });

  test("ecommerce claim → MissionCard flips to Claimed + balance updates without nav", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Capture the URL so we can confirm the claim doesn't trigger a nav.
    const urlBefore = page.url();

    // Drive Triple Treat to completed: 3× Buy on the books product.
    const tripleTreat = page.locator(".qk-mission-card", {
      hasText: "Triple Treat",
    });
    await expect(tripleTreat).toBeVisible({ timeout: 8_000 });

    const books = page.getByRole("button", { name: /Pragmatic Coder/ });
    for (let i = 0; i < 3; i++) {
      await books.click();
      await page.waitForTimeout(400);
    }

    // Wait for the card to show Claim, then capture the pre-claim balance.
    const claimBtn = tripleTreat.locator(".qk-mission-card-claim");
    await expect(claimBtn).toBeEnabled({ timeout: 5_000 });

    const balanceWidget = page.getByRole("status", {
      name: /current balance: \d+ coin/i,
    });
    await expect(balanceWidget).toBeVisible({ timeout: 8_000 });
    const beforeLabel = (await balanceWidget.getAttribute("aria-label")) ?? "";
    const beforeAmount = Number.parseInt(
      beforeLabel.match(/(\d+)/)?.[1] ?? "0",
      10,
    );

    // Click Claim and time the flip to Claimed.
    const start = Date.now();
    await claimBtn.click();

    // Within 2 s the card MUST surface the terminal status (via the SSE
    // mission.claimed event from TASK-001 or the refetch fallback).
    await expect(claimBtn).toHaveText(/claimed/i, { timeout: 2_000 });
    await expect(claimBtn).toBeDisabled();
    await expect(tripleTreat).toHaveAttribute("data-status", "claimed");

    const elapsed = Date.now() - start;
    expect(elapsed, "Claim → Claimed within 2 s").toBeLessThan(2_000);

    // Balance widget must reflect +100 coin from the Triple Treat reward.
    await expect
      .poll(
        async () => {
          const label = (await balanceWidget.getAttribute("aria-label")) ?? "";
          return Number.parseInt(label.match(/(\d+)/)?.[1] ?? "0", 10);
        },
        { timeout: 2_500, intervals: [100, 200, 400] },
      )
      .toBeGreaterThan(beforeAmount);

    // No navigation: the URL must be unchanged after the claim.
    expect(page.url(), "claim must not navigate").toBe(urlBefore);

    expect(consoleErrors).toEqual([]);
  });

  test("streaming claim → Today's progress widget shows 3/3 + MissionCard claimed without nav", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/streaming");

    const urlBefore = page.url();

    // The "Today's progress" widget mirrors mis_stream_documentary_3 (count
    // 3, filter genre=documentary). The library has 2 documentaries —
    // Planet Earth III (first card) and Blue Worlds (last card) — so we
    // need to fire video.watched on documentary genre 3 times. The 2
    // doc videos in the library each fire one event per click; we can
    // re-click Planet Earth III a third time to reach the target. The
    // server's rule engine doesn't dedupe by videoId — it counts events.
    const curiousMind = page.locator(".qk-mission-card", {
      hasText: "Curious Mind",
    });
    await expect(curiousMind).toBeVisible({ timeout: 8_000 });

    // Watch Planet Earth III twice, then Blue Worlds once — 3 documentary
    // events total. Each Watch fires video.watched with genre=documentary.
    const watchPlanet = page.getByRole("button", { name: /watch planet/i });
    const watchBlue = page.getByRole("button", { name: /watch blue worlds/i });
    await expect(watchPlanet).toBeVisible({ timeout: 5_000 });
    await expect(watchBlue).toBeVisible();

    await watchPlanet.click();
    await page.waitForTimeout(400);
    await watchPlanet.click();
    await page.waitForTimeout(400);
    await watchBlue.click();
    await page.waitForTimeout(400);

    // Card must report 3/3 and surface Claim.
    await expect(
      curiousMind.locator(".qk-mission-card-progress-text"),
    ).toContainText("3 / 3", { timeout: 5_000 });

    const claimBtn = curiousMind.locator(".qk-mission-card-claim");
    await expect(claimBtn).toBeEnabled({ timeout: 3_000 });

    // Click Claim.
    const start = Date.now();
    await claimBtn.click();

    // Within 2 s the card flips to Claimed.
    await expect(claimBtn).toHaveText(/claimed/i, { timeout: 2_000 });
    await expect(curiousMind).toHaveAttribute("data-status", "claimed");
    const elapsed = Date.now() - start;
    expect(elapsed, "Claim → Claimed within 2 s").toBeLessThan(2_000);

    // The "Today's progress" widget (which TASK-002 wired to read from
    // the same useMissions() data) MUST still show 3/3 — the server's
    // claimed state preserves currentCount, and the widget reads it
    // directly. This is the B3/D1 regression fix.
    await expect(page.getByText(/^3\/3$/)).toBeVisible({ timeout: 2_000 });

    // The widget's trophy icon should appear (watchedToday >= target).
    // We anchor on the aria-label text since the 🏆 emoji is in an
    // aria-hidden div — the count label is the public signal.
    await expect(page.getByLabel(/3 of 3 watched/i)).toBeVisible();

    // No navigation.
    expect(page.url(), "claim must not navigate").toBe(urlBefore);

    expect(consoleErrors).toEqual([]);
  });

  test("daily claim → streak hero shows checked-in state from server without nav", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/daily");

    const urlBefore = page.url();

    // Check in fires daily.login, which the rule engine matches against
    // mis_daily_visitor (count=1, daily). The streak hero now reads
    // from useMissions() — no localStorage mirror — so the post-check-in
    // and post-claim states both come from the server's MissionProgress
    // row.
    const checkInBtn = page.getByRole("button", {
      name: /check in for today/i,
    });
    await expect(checkInBtn).toBeEnabled({ timeout: 8_000 });
    await checkInBtn.click();

    // Once the daily.login event lands and useMissions reflects the row,
    // the button flips to "Already checked in today" + disabled state.
    // This is the B4/D1 fix: WITHOUT TASK-002's server-derived
    // claimedToday, the button would still read "Check in" even after
    // a successful fire (the localStorage mirror used to update only
    // inside the fire-event handler, which had its own bugs).
    await expect(
      page.getByRole("button", { name: /already checked in today/i }),
    ).toBeDisabled({ timeout: 5_000 });

    // Hero copy + streak count update from the server row.
    await expect(
      page.getByText(/already checked in today — come back tomorrow/i),
    ).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/^1$/)).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/^day$/)).toBeVisible();

    // Now claim the Daily Visitor mission (count=1 so it should already
    // be completed). The MissionCard for Daily Visitor surfaces Claim;
    // clicking it triggers mission.claimed + the refetch fallback.
    const dailyVisitor = page.locator(".qk-mission-card", {
      hasText: "Daily Visitor",
    });
    await expect(dailyVisitor).toBeVisible({ timeout: 5_000 });
    const claimBtn = dailyVisitor.locator(".qk-mission-card-claim");
    await expect(claimBtn).toBeEnabled({ timeout: 5_000 });

    const start = Date.now();
    await claimBtn.click();
    await expect(claimBtn).toHaveText(/claimed/i, { timeout: 2_000 });
    await expect(dailyVisitor).toHaveAttribute("data-status", "claimed");
    const elapsed = Date.now() - start;
    expect(elapsed, "Claim → Claimed within 2 s").toBeLessThan(2_000);

    // The hero still shows the checked-in copy (claimedToday is now
    // derived from status === "claimed" — even stronger signal).
    await expect(
      page.getByRole("button", { name: /already checked in today/i }),
    ).toBeDisabled();
    await expect(
      page.getByText(/already checked in today — come back tomorrow/i),
    ).toBeVisible();

    // No navigation.
    expect(page.url(), "claim must not navigate").toBe(urlBefore);

    expect(consoleErrors).toEqual([]);
  });
});
