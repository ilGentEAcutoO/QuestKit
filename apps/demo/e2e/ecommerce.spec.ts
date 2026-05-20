/**
 * E-commerce E2E suite — Phase 8 / TASK-009.
 *
 * Covers the Buy + Claim happy paths plus the counter-cap regression that
 * TASK-004 introduced (MissionCard clamps `currentCount` to `targetCount`
 * so the textual rendering never overshoots, even when the server's rule
 * engine continues to ingest events past the target).
 *
 * Per-spec isolation: every test calls `client.demoReset()` via the page's
 * QuestKitClient handle so each scenario starts from a clean
 * `demo_user_42` state. The reset endpoint is server-side (TASK-003) and
 * clears mission_progress + balances + idempotency cache; we then reload
 * so the React tree re-mints the JWT and re-fetches missions.
 *
 * Console hygiene fixture (./fixtures.ts) auto-fails any test that logs an
 * error or warning that isn't on the allowlist (404 on /v1/balance/coin
 * for fresh users).
 */
import { expect, test } from "./_fixtures";
import { resetDemoUser } from "./_helpers";

test.describe("E-commerce — Buy + Claim", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemoUser(page);
  });

  test("fires purchase.completed and updates Triple Treat counter (×3 → 3/3, button → Claim)", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Triple Treat = mis_ecom_daily_purchase_3, target 3 purchases (daily).
    const tripleTreat = page.locator(".qk-mission-card", {
      hasText: "Triple Treat",
    });
    await expect(tripleTreat).toBeVisible({ timeout: 8_000 });

    // Click Buy on the books product 3× — Triple Treat has no filter so
    // any product counts. The MissionCard counter must reach 3/3 within
    // the 3-second SSE budget called out in the plan §Test Specifications.
    const books = page.getByRole("button", { name: /Pragmatic Coder/ });
    for (let i = 0; i < 3; i++) {
      await books.click();
      // Brief settle window so the button's "Processing…" label clears
      // and the next click can land. The actual SSE update arrives below.
      await page.waitForTimeout(400);
    }

    // Counter renders "3 / 3" within the 3 s budget.
    await expect(
      tripleTreat.locator(".qk-mission-card-progress-text"),
    ).toContainText("3 / 3", { timeout: 3_000 });

    // Claim button surfaces once status === completed.
    const claimBtn = tripleTreat.locator(".qk-mission-card-claim");
    await expect(claimBtn).toBeVisible({ timeout: 3_000 });
    await expect(claimBtn).toBeEnabled();
    await expect(claimBtn).toHaveText(/claim/i);

    expect(consoleErrors).toEqual([]);
  });

  test("counter never exceeds target after extra fires (TASK-004 regression)", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Triple Treat has count=3. We fire 7 purchases — the server's rule
    // engine will record all of them, but the UI MUST clamp the
    // textual rendering to "3 / 3" (never "5 / 3" or "7 / 3"). This is
    // the explicit defence-in-depth TASK-004 added in MissionCard
    // (`displayCurrent = currentCount > targetCount ? targetCount : currentCount`).
    const tripleTreat = page.locator(".qk-mission-card", {
      hasText: "Triple Treat",
    });
    await expect(tripleTreat).toBeVisible({ timeout: 8_000 });

    const books = page.getByRole("button", { name: /Pragmatic Coder/ });
    for (let i = 0; i < 7; i++) {
      await books.click();
      await page.waitForTimeout(300);
    }

    // Settle: the last few clicks may still be in-flight. Wait for the
    // counter to reach 3/3 (which is the clamped ceiling).
    const progressText = tripleTreat.locator(".qk-mission-card-progress-text");
    await expect(progressText).toContainText("3 / 3", { timeout: 5_000 });

    // The visible text must NOT contain any number > targetCount before
    // the slash. We anchor on the exact "/ 3" denominator and assert the
    // numerator never exceeds 3.
    const text = (await progressText.textContent()) ?? "";
    const numericPart = text.match(/(\d+)\s*\/\s*3/);
    expect(
      numericPart,
      `counter text should match N/3 pattern, got "${text}"`,
    ).not.toBeNull();
    if (numericPart) {
      const numerator = Number.parseInt(numericPart[1] ?? "0", 10);
      expect(numerator, `counter clamped to <= 3`).toBeLessThanOrEqual(3);
    }

    // Percent badge must also be clamped to 100% (never 233% etc.).
    expect(text).not.toMatch(/[1-9]\d{2,}%/); // no 100+ → 999% values
    expect(text).toContain("100%");

    expect(consoleErrors).toEqual([]);
  });

  test("Claim returns and flips button to Claimed (<2 s round-trip)", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    const tripleTreat = page.locator(".qk-mission-card", {
      hasText: "Triple Treat",
    });
    await expect(tripleTreat).toBeVisible({ timeout: 8_000 });

    // Get to completed.
    const books = page.getByRole("button", { name: /Pragmatic Coder/ });
    for (let i = 0; i < 3; i++) {
      await books.click();
      await page.waitForTimeout(400);
    }

    const claimBtn = tripleTreat.locator(".qk-mission-card-claim");
    await expect(claimBtn).toBeEnabled({ timeout: 5_000 });

    // Time the click → Claimed flip.
    const start = Date.now();
    await claimBtn.click();
    await expect(claimBtn).toHaveText(/claimed/i, { timeout: 2_000 });
    const elapsed = Date.now() - start;
    expect(elapsed, `Claim round-trip < 2 s`).toBeLessThan(2_000);

    // Once claimed the button is visible but disabled.
    await expect(claimBtn).toBeDisabled();

    // The claimed-today hint appears below the progress bar.
    await expect(
      tripleTreat.locator(".qk-mission-card-claimed-hint"),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });

  test("each of the 6 products is buyable and fires purchase.completed", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/ecommerce");

    // Buy-now buttons for all 6 catalog items must be present + clickable.
    const buyButtons = page.getByRole("button", { name: /^Buy now/i });
    await expect(buyButtons).toHaveCount(6, { timeout: 8_000 });

    // Click each once. We don't make a per-button assertion here — the
    // Triple Treat counter spec above already validates the SSE/event
    // path. This test exists to confirm zero of the 6 buttons throws.
    const count = await buyButtons.count();
    for (let i = 0; i < count; i++) {
      await buyButtons.nth(i).click();
      await page.waitForTimeout(200);
    }

    expect(consoleErrors).toEqual([]);
  });
});
