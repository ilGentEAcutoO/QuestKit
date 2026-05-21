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

// TASK-005 / Phase 9 — Cloudflare Bot Management challenges GitHub Actions
// runner IPs on POST /api/token (Better Auth's unauthenticated token-mint
// endpoint). Manual users on residential IPs sail through; CI runners get
// a JS challenge Playwright cannot solve at the HTTP layer. The mitigation
// is a CF WAF custom rule (see docs/SELF_HOSTING.md §8.6) that skips Super
// Bot Fight Mode + Managed Rules ONLY when the request carries this header
// with the matching 32-byte hex secret. Stored in the GitHub Actions secret
// `CI_BOT_BYPASS_TOKEN` and in the CF dashboard rule expression.
//
// Gate is `target === "prod" && bypassToken`:
//   - Never sent in local mode (no need, no CF in front of vite dev)
//   - Header omitted if the secret isn't wired yet — production rule will
//     then reject those requests via normal bot scoring, which is correct
//     fail-closed behaviour.
//   - Safe to leak: the upstream APP_SECRET (held only by the demo worker)
//     is still required to mint a real token; this header just bypasses
//     bot scoring on /api/token.
const bypassToken = process.env.CI_BOT_BYPASS_TOKEN;
const ciBypassHeaders =
  target === "prod" && bypassToken
    ? { "x-questkit-ci-bypass": bypassToken }
    : undefined;

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
    // Attached to every request (HTML nav, fetch, XHR, API context). Only
    // populated in prod mode when CI_BOT_BYPASS_TOKEN is set — see the
    // `ciBypassHeaders` block above for the full rationale.
    extraHTTPHeaders: ciBypassHeaders,
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
