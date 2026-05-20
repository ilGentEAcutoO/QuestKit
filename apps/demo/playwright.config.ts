import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the QuestKit demo end-to-end suite.
 *
 * Two run modes via env var:
 *   E2E_TARGET=local  (default) — start `vite` on :5173 and hit it
 *   E2E_TARGET=prod              — hit https://questkit.jairukchan.com directly
 *
 * The smoke spec uses fixtures that auto-assert "zero console errors,
 * zero warnings" in afterEach — the e2e-planner brief calls this the
 * "console hygiene" gate. Allowed exception: 404s on /v1/balance/coin
 * (expected when a freshly-minted user has no balance row yet).
 */
const target = process.env.E2E_TARGET ?? "local";
const baseURL =
  target === "prod"
    ? "https://questkit.jairukchan.com"
    : "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // serialize so the demo_user_42 state doesn't race
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Dual reporter on CI: `github` annotates the workflow log with
  // failure summaries; `html` writes a self-contained ./playwright-report
  // directory that the deploy.yml uploads as an artifact on failure
  // (TASK-009 — maintainer downloads it to see screenshots, videos,
  // and traces). `never` keeps Playwright from auto-opening the report
  // in a browser on local runs (we still get the `list` reporter for
  // those via the else branch).
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL,
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium-desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Only start the dev server in "local" mode. Production runs hit the live
  // demo worker and skip the local build.
  webServer:
    target === "local"
      ? {
          command: "pnpm dev",
          url: "http://localhost:5173",
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        }
      : undefined,
});
