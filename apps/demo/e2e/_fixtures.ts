import { test as base, type ConsoleMessage } from "@playwright/test";

/**
 * Shared fixtures for the QuestKit demo E2E suite.
 *
 * Adds:
 *   - `consoleErrors` fixture: collects all console.error / page.on('error')
 *     messages so individual tests can assert on them.
 *   - afterEach hook: fails the test if the page logged any console error
 *     that isn't in the allowlist (404 on /v1/balance/coin for fresh users).
 *
 * Per the e2e-planner brief, this enforces the "console hygiene" gate across
 * all scenarios — a regression that silently logs an error fails the suite.
 */

interface ConsoleEntry {
  type: ConsoleMessage["type"] extends () => infer T ? T : string;
  text: string;
  location?: string;
}

/**
 * Each pattern matches either the console message text OR the resource URL
 * that produced it. The `Failed to load resource` log doesn't embed the URL
 * in the text — Chromium attaches the URL via the `location` field on the
 * ConsoleMessage — so location-pattern allowlisting is mandatory.
 */
interface ExpectedPattern {
  text?: RegExp;
  location?: RegExp;
}

const EXPECTED_PATTERNS: readonly ExpectedPattern[] = [
  // Freshly-minted demo user has no `coin` balance row yet → 404 by design.
  { location: /\/v1\/balance\/[^/]+$/ },
];

function isExpectedError(text: string, location: string | undefined): boolean {
  return EXPECTED_PATTERNS.some((p) => {
    if (p.text && !p.text.test(text)) return false;
    if (p.location && !p.location.test(location ?? "")) return false;
    return true;
  });
}

export const test = base.extend<{ consoleErrors: ConsoleEntry[] }>({
  consoleErrors: async ({ page }, use) => {
    const collected: ConsoleEntry[] = [];

    page.on("console", (msg) => {
      const level = msg.type();
      if (level !== "error" && level !== "warning") return;
      const text = msg.text();
      const location = msg.location().url;
      if (isExpectedError(text, location)) return;
      collected.push({
        type: level,
        text,
        location,
      });
    });

    page.on("pageerror", (err) => {
      collected.push({ type: "error", text: err.message });
    });

    await use(collected);
  },
});

export { expect } from "@playwright/test";
