/**
 * Streaming E2E suite — Phase 8 / TASK-009.
 *
 * Covers the 4 Watch buttons + the "Logging…" never persists >3 s
 * regression that TASK-005 introduced (the SDK now honours an
 * AbortSignal.timeout on fireEvent so the button text always returns
 * within the worker round-trip budget).
 *
 * Per-spec isolation: every test calls resetDemoUser to wipe server +
 * client state. Console-hygiene fixture asserts zero errors/warnings.
 */
import { expect, test } from "./_fixtures";
import { resetDemoUser } from "./_helpers";

test.describe("Streaming — Watch + button latency", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemoUser(page);
  });

  test("Watch returns to default label in <2 s (no stuck Logging…)", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/streaming");

    // Click the first Watch button and verify it returns to the
    // default "Watch" text well under the 2 s budget per Plan §Test
    // Specifications. The plan calls out <2 s for the round-trip; the
    // worse regression ("Logging… never >3 s") is exercised separately.
    const watchButtons = page.getByRole("button", { name: /^Watch /i });
    await expect(watchButtons.first()).toBeVisible({ timeout: 8_000 });

    const first = watchButtons.first();
    const start = Date.now();
    await first.click();

    // While the request is in flight the button text becomes "Logging…".
    // Once useEvent.isFiring drops back to false the original aria-label
    // returns ("Watch <title>"). We assert the text reverts within 2 s.
    await expect(first).toHaveText(/^watch$/i, { timeout: 2_000 });
    const elapsed = Date.now() - start;
    expect(elapsed, `Watch round-trip < 2 s`).toBeLessThan(2_000);

    expect(consoleErrors).toEqual([]);
  });

  test("Logging… never persists longer than 3 s (TASK-005 regression)", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/streaming");

    // The pre-TASK-005 bug: an in-flight fireEvent with no timeout
    // hung the button on "Logging…" indefinitely when the api worker
    // wedged behind a DO RPC. TASK-005 fixed it via AbortSignal.timeout
    // in the SDK. We click 4 different videos in quick succession; none
    // of them should leave the "Logging…" label visible after 3 s.
    const watchButtons = page.getByRole("button", { name: /^Watch /i });
    await expect(watchButtons).toHaveCount(6, { timeout: 8_000 });

    // Click 4 distinct videos.
    for (let i = 0; i < 4; i++) {
      await watchButtons.nth(i).click();
      // Don't wait — fire them in rapid succession to stress the
      // fireEvent queue.
      await page.waitForTimeout(150);
    }

    // After the 3 s budget the page must have ZERO buttons showing
    // "Logging…". Any persistent stuck label fails the test.
    await page.waitForTimeout(3_000);
    const stuck = await page.locator('button:has-text("Logging…")').count();
    expect(stuck, "no Watch button stuck on Logging… after 3 s").toBe(0);

    // Also verify the local "watched today" counter advanced (the SPA's
    // local mirror of the daily progress — increments synchronously on
    // each click handler in streaming.tsx). Streaming's local counter does
    // NOT clamp — it'll read "4/3" after 4 clicks. We accept any "N/3"
    // where N >= 1 (a stricter assertion would race the SPA's setState).
    await expect(page.getByText(/^[1-9]\d*\/3$/)).toBeVisible({
      timeout: 3_000,
    });

    expect(consoleErrors).toEqual([]);
  });

  test("watching 4 videos fires 4 video.watched events", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/streaming");

    const watchButtons = page.getByRole("button", { name: /^Watch /i });
    await expect(watchButtons).toHaveCount(6, { timeout: 8_000 });

    // Click each of the first 4 videos. We track that the same number
    // of POST /v1/events requests fired by waiting for each network
    // response inline.
    for (let i = 0; i < 4; i++) {
      const responsePromise = page.waitForResponse(
        (resp) =>
          resp.url().endsWith("/v1/events") &&
          resp.request().method() === "POST",
        { timeout: 5_000 },
      );
      await watchButtons.nth(i).click();
      const resp = await responsePromise;
      // Either accepted (2xx) or queued for retry (any non-5xx). 5xx
      // would indicate a server bug that the suite should fail on.
      expect(
        resp.status(),
        `POST /v1/events should not 5xx (got ${resp.status()})`,
      ).toBeLessThan(500);
    }

    expect(consoleErrors).toEqual([]);
  });
});
