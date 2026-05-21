/**
 * Daily streak E2E suite — Phase 8 / TASK-009; persistence model updated
 * in Phase 9 / TASK-002.
 *
 * Covers Check in → streak counter increments + persists across reload.
 *
 * The Daily Visitor mission (mis_daily_visitor, added in migration 0003)
 * has count=1/window=daily, so a single check-in moves it to 1/1 +
 * status=completed and surfaces the Claim button.
 *
 * Persistence model: Phase 9 / TASK-002 removed the localStorage mirror
 * (`qk-demo-daily-streak`). The streak hero now reads directly from
 * `useMissions().data.progress[mis_daily_visitor]`, so reload-persistence
 * comes from the server's MissionProgress row (re-fetched on mount).
 * The reload-persistence test below verifies the SAME contract via the
 * new path: the row's currentCount=1 + status=completed/claimed survives
 * the reload, which keeps the "Already checked in today" button disabled.
 *
 * Note on idempotence: the daily.login event is rate-limited to one per
 * UTC day per user — a second click within the same day is a no-op
 * server-side. resetDemoUser wipes the per-user idempotency cache so the
 * test always starts in the "claimable" state.
 */
import { expect, test } from "./_fixtures";
import { resetDemoUser } from "./_helpers";

test.describe("Daily streak — Check in", () => {
  test.beforeEach(async ({ page }) => {
    await resetDemoUser(page);
  });

  test("Check in increments streak counter and updates Daily Visitor mission", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/daily");

    // Pre-reset the streak should be 0.
    await expect(page.getByText(/current streak/i)).toBeVisible({
      timeout: 8_000,
    });

    const checkInBtn = page.getByRole("button", {
      name: /check in for today/i,
    });
    await expect(checkInBtn).toBeEnabled();

    await checkInBtn.click();

    // The button label flips to "Checked in" (or "Saving…" briefly) once
    // claimedToday goes true. Wait for the disabled state to settle —
    // this is also a proxy for the local streak state having updated.
    await expect(
      page.getByRole("button", { name: /already checked in today/i }),
    ).toBeDisabled({ timeout: 5_000 });

    // Streak counter increments to 1. The number lives in a tabular-nums
    // <motion.span> sibling to the "day(s)" label — we anchor on the
    // "1 day" pair to avoid matching unrelated "1"s in the DOM.
    await expect(page.getByText(/^1$/)).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/^day$/)).toBeVisible();

    // The Daily Visitor mission card should report 1/1 + show a Claim button.
    const dailyVisitor = page.locator(".qk-mission-card", {
      hasText: "Daily Visitor",
    });
    await expect(dailyVisitor).toBeVisible({ timeout: 5_000 });
    await expect(
      dailyVisitor.locator(".qk-mission-card-progress-text"),
    ).toContainText("1 / 1", { timeout: 3_000 });
    await expect(dailyVisitor.locator(".qk-mission-card-claim")).toBeVisible({
      timeout: 3_000,
    });

    expect(consoleErrors).toEqual([]);
  });

  test("Streak persists across page reload (server MissionProgress round-trip)", async ({
    page,
    consoleErrors,
  }) => {
    await page.goto("/daily");

    const checkInBtn = page.getByRole("button", {
      name: /check in for today/i,
    });
    await expect(checkInBtn).toBeEnabled({ timeout: 8_000 });
    await checkInBtn.click();

    // Wait for the button to flip to "Checked in" — this is a proxy for
    // the server's MissionProgress row having flushed and useMissions
    // having merged the SSE / optimistic update.
    await expect(
      page.getByRole("button", { name: /already checked in today/i }),
    ).toBeDisabled({ timeout: 5_000 });

    // Hard reload. Phase 9 / TASK-002 removed the localStorage mirror —
    // persistence now comes from re-fetching useMissions on mount, which
    // re-hydrates progress[mis_daily_visitor]. The disabled button +
    // streak count proves the server row carried across the navigation.
    await page.reload();
    await expect(page.getByRole("status", { name: /loading questkit demo/i }))
      .waitFor({ state: "detached", timeout: 15_000 })
      .catch(() => {
        // already gone
      });

    // After reload, the daily route fetches missions and derives
    // claimedToday from progress[mis_daily_visitor].status / updatedAt.
    // The strongest signal is:
    //   (a) the "Already checked in today" button is disabled (claimedToday
    //       derived from the server's MissionProgress row), AND
    //   (b) the number "1" + "day" pair renders next to "Current streak"
    //       (currentCount from the same row).
    await expect(
      page.getByRole("button", { name: /already checked in today/i }),
    ).toBeDisabled({ timeout: 10_000 });
    await expect(page.getByText(/^1$/)).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText(/^day$/)).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});
