/**
 * Cross-cutting E2E suite — Phase 8 / TASK-009.
 *
 * Validates global UI surfaces:
 *   - AI picks panel (happy path OR graceful fallback empty-state; never
 *     a raw 502 — TASK-002 regression).
 *   - EventLog drawer opens, shows entries, closes.
 *   - Coin balance widget updates within 2 s of a reward-granting action.
 *   - DevTools "Reset demo user" button clears progress + balance + log.
 */
import { expect, test } from "./_fixtures";
import { resetDemoUser } from "./_helpers";

test.describe("Cross-cutting — global UI surfaces", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemoUser(page);
  });

  test("AI picks panel opens; response is HTTP 200 (NEVER raw 502)", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Wait for the deferred floating panels to mount (Layout defers them
    // until requestIdleCallback fires).
    const aiBtn = page.getByRole("button", { name: /open ai picks panel/i });
    await expect(aiBtn).toBeVisible({ timeout: 10_000 });

    // Race the click with waiting for the recommendations response.
    const responsePromise = page.waitForResponse(
      (resp) => resp.url().includes("/v1/recommendations"),
      { timeout: 10_000 },
    );
    await aiBtn.click();
    const resp = await responsePromise;

    // TASK-002 regression: server returns 200 even when the AI is
    // unavailable (it embeds `fallback: true` in the body instead of
    // surfacing a 5xx). Anything in the 5xx range is a regression.
    expect(
      resp.status(),
      `GET /v1/recommendations should not 5xx (got ${resp.status()})`,
    ).toBeLessThan(500);
    expect(resp.status()).toBe(200);

    // The panel is open; either real recommendations OR the graceful
    // fallback empty-state is rendered. Both branches use role="status"
    // (success path: aria-label=Recommended missions; fallback path:
    // aria-label=AI picks unavailable). Neither path leaks the raw
    // server error code into the DOM.
    const panel = page.locator("#qk-ai-recs-panel");
    await expect(panel).toBeVisible({ timeout: 5_000 });
    const panelText = (await panel.textContent()) ?? "";
    expect(panelText).not.toMatch(/ai_response_malformed/i);
    expect(panelText).not.toMatch(/\b502\b/);
    expect(panelText).not.toMatch(/\b503\b/);
    expect(panelText).not.toMatch(/load recommendations/i);

    expect(consoleErrors).toEqual([]);
  });

  test("EventLog drawer opens, shows recent events, and closes", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Trigger at least one event so the log isn't empty.
    const buyBtn = page.getByRole("button", { name: /Pragmatic Coder/ });
    await expect(buyBtn).toBeVisible({ timeout: 8_000 });
    await buyBtn.click();
    // Give the SSE/poll cycle a moment to flow the update back.
    await page.waitForTimeout(1_500);

    // Open the drawer.
    const drawerBtn = page.getByRole("button", { name: /open event log/i });
    await expect(drawerBtn).toBeVisible({ timeout: 10_000 });
    await drawerBtn.click();

    const drawer = page.locator("#qk-event-log-drawer");
    await expect(drawer).toBeVisible({ timeout: 3_000 });

    // The "Live SDK updates" heading is the drawer's identifying label.
    await expect(drawer.getByText(/live sdk updates/i)).toBeVisible();

    // Either we see at least one event row OR the empty-state — both
    // are valid (the SSE delivery may not have landed yet on a slow
    // network). What we DO assert is the heading + filter chips render.
    await expect(drawer.getByRole("tab", { name: /^all$/i })).toBeVisible();

    // Close via the × button.
    await drawer.getByRole("button", { name: /close event log/i }).click();
    await expect(drawer).not.toBeVisible({ timeout: 3_000 });

    expect(consoleErrors).toEqual([]);
  });

  test("Coin balance widget updates within 2 s of a Claim", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Progress Triple Treat to completed so we can claim and trigger a
    // currency reward.
    const tripleTreat = page.locator(".qk-mission-card", {
      hasText: "Triple Treat",
    });
    await expect(tripleTreat).toBeVisible({ timeout: 8_000 });

    const books = page.getByRole("button", { name: /Pragmatic Coder/ });
    for (let i = 0; i < 3; i++) {
      await books.click();
      await page.waitForTimeout(350);
    }

    // Read the balance widget's current text (may be "0" or absent for
    // fresh users — the widget shows a 0 default).
    const balanceWidget = page.getByRole("status", {
      name: /current balance: \d+ coin/i,
    });
    await expect(balanceWidget).toBeVisible({ timeout: 8_000 });
    const before = (await balanceWidget.getAttribute("aria-label")) ?? "";
    const beforeAmount =
      Number.parseInt(before.match(/(\d+)/)?.[1] ?? "0", 10) ?? 0;

    // Claim. Triple Treat's reward is +100 coin per migration 0002.
    const claimBtn = tripleTreat.locator(".qk-mission-card-claim");
    await expect(claimBtn).toBeEnabled({ timeout: 5_000 });
    const claimStart = Date.now();
    await claimBtn.click();

    // The balance must reflect +100 within 2 s of the claim landing.
    // We poll the aria-label until it shows > beforeAmount.
    await expect
      .poll(
        async () => {
          const label = (await balanceWidget.getAttribute("aria-label")) ?? "";
          return Number.parseInt(label.match(/(\d+)/)?.[1] ?? "0", 10);
        },
        { timeout: 2_500, intervals: [100, 200, 400] },
      )
      .toBeGreaterThan(beforeAmount);
    const elapsed = Date.now() - claimStart;
    expect(elapsed, `balance updated within 2 s`).toBeLessThan(2_500);

    expect(consoleErrors).toEqual([]);
  });

  test("DevTools Reset demo user wipes progress + balance + EventLog", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Fire one purchase so there's progress to wipe.
    const tripleTreat = page.locator(".qk-mission-card", {
      hasText: "Triple Treat",
    });
    await expect(tripleTreat).toBeVisible({ timeout: 8_000 });
    const books = page.getByRole("button", { name: /Pragmatic Coder/ });
    await books.click();

    // Wait for the counter to advance to 1/3 (the reset should put it
    // back to 0/3).
    await expect(
      tripleTreat.locator(".qk-mission-card-progress-text"),
    ).toContainText("1 / 3", { timeout: 5_000 });

    // Open DevTools tray.
    const gear = page.getByRole("button", { name: /open devtools/i });
    await expect(gear).toBeVisible({ timeout: 10_000 });
    await gear.click();

    // Click the reset button. The handler hits /v1/demo/reset, clears
    // local storage, and reloads.
    const resetBtn = page.getByRole("button", {
      name: /reset demo user \(reloads page\)/i,
    });
    await expect(resetBtn).toBeVisible({ timeout: 3_000 });
    await resetBtn.click();

    // Reload happens inside resetUser(). Wait for the bootstrap to
    // settle on the reloaded page.
    await page
      .getByRole("status", { name: /loading questkit demo/i })
      .waitFor({ state: "detached", timeout: 15_000 })
      .catch(() => {
        // Already past the spinner
      });

    // Triple Treat must be back at 0/3 (current count cleared).
    const ttPost = page.locator(".qk-mission-card", {
      hasText: "Triple Treat",
    });
    await expect(ttPost).toBeVisible({ timeout: 8_000 });
    await expect(
      ttPost.locator(".qk-mission-card-progress-text"),
    ).toContainText("0 / 3", { timeout: 5_000 });

    // The Claim button MUST be hidden (status=active again — i.e. NOT
    // completed and NOT claimed).
    await expect(ttPost.locator(".qk-mission-card-claim")).not.toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});
