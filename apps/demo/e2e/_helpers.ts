import type { Page } from "@playwright/test";

/**
 * Shared E2E helpers for the QuestKit demo suite (Phase 8 / TASK-009).
 *
 * resetDemoUser drives the same flow the DevTools "Reset demo user" button
 * uses, but without depending on the lazily-mounted DevTools UI being
 * visible. We:
 *   1. Navigate to apex (which renders /ecommerce, mints the JWT, and
 *      establishes the API client + SSE connection).
 *   2. Wait for the bootstrap "Loading QuestKit demo" status to clear so
 *      the demo's QuestKitProvider has finished its JWT mint.
 *   3. Call POST /api/token directly (the same proxy DevTools uses) to
 *      mint a fresh token, then POST /v1/demo/reset to the api worker
 *      with that Bearer.
 *   4. Clear the localStorage keys DevTools clears
 *      (qk-demo-daily-streak, qk-spin-demo-spin, qk-event-queue, and the
 *      cached JWT keys).
 *   5. Reload — same hard-reset semantics DevTools uses so the React
 *      tree re-mounts with zero progress.
 *
 * Why not click the DevTools button? It works in interactive sessions but
 * adds two flakiness sources to the suite: (a) DevTools is deferred until
 * `requestIdleCallback` resolves, which on CI can race against our wait;
 * (b) the tray animates open via framer-motion, so we'd need a settle
 * delay. Driving the same endpoint via fetch is deterministic and lets
 * any spec (including the cross-cutting spec that itself tests the
 * DevTools UI) start from a clean state.
 *
 * The api base + app id mirror apps/demo/src/lib/client.tsx. Keep in sync
 * if those constants ever move.
 */
const DEMO_API_BASE = "https://api.questkit.jairukchan.com";

export async function resetDemoUser(page: Page): Promise<void> {
  // Step 1: navigate to the apex. The Layout owns the QuestKitClient and
  // we need a window context to evaluate the reset in. We do this BEFORE
  // the reset so the test's network requests share the same origin
  // (avoids CORS preflights on the /api/token proxy).
  await page.goto("/");

  // Wait for the bootstrap spinner to clear — DemoClientProvider only
  // renders the route tree after `mintToken(userId)` resolves.
  await page
    .getByRole("status", { name: /loading questkit demo/i })
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => {
      // If the status was never present (already past it) the wait
      // rejects; that's a successful state, swallow it.
    });

  // Step 2: hit POST /api/token to mint a JWT, then POST /v1/demo/reset
  // with that Bearer. Both calls run inside the page context so cookies
  // / same-origin policy match a real DevTools click.
  await page.evaluate(
    async ({ apiBase }: { apiBase: string }) => {
      // The page's URLSearchParams may carry ?user=demo_user_42 (the
      // SPA's override convention) — mirror that here.
      const params = new URLSearchParams(window.location.search);
      const userIdOverride = params.get("user");
      const userId =
        userIdOverride !== null && /^[\w-]{3,40}$/.test(userIdOverride)
          ? userIdOverride
          : "demo_user_42";

      // Mint via the same /api/token proxy the DemoClientProvider uses.
      const mintResp = await fetch("/api/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (!mintResp.ok) {
        throw new Error(
          `mint /api/token failed: ${mintResp.status} ${await mintResp.text()}`,
        );
      }
      const { token } = (await mintResp.json()) as { token: string };

      // Hit the server-side reset endpoint.
      const resetResp = await fetch(`${apiBase}/v1/demo/reset`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!resetResp.ok) {
        throw new Error(
          `POST /v1/demo/reset failed: ${resetResp.status} ${await resetResp.text()}`,
        );
      }

      // Mirror DevTools' localStorage scrub. The keys match
      // STORAGE_KEYS_TO_CLEAR in apps/demo/src/panels/DevTools.tsx plus
      // the JWT cache keys the SDK plants under `qk:auth:*`. The event
      // queue key (`qk:event-queue`) is exported from @questkit/core as
      // EVENT_QUEUE_STORAGE_KEY — we inline the literal here to avoid
      // bundling SDK code into the test page evaluate scope.
      const keysToClear = [
        "qk-demo-daily-streak",
        "qk-spin-demo-spin",
        "qk:event-queue",
      ];
      for (const k of keysToClear) {
        try {
          window.localStorage.removeItem(k);
        } catch {
          // privacy mode — ignore
        }
      }
      // Note: the demo's JWT cache lives in a JS Map (apps/demo/src/lib/
      // auth.ts), not localStorage. The hard reload below clears it
      // automatically when the JS module re-evaluates.
    },
    { apiBase: DEMO_API_BASE },
  );

  // Step 3: hard reload so the React tree re-mounts with a fresh client
  // and re-fetches missions (which now have zero progress server-side).
  await page.reload();

  // Wait one more time for the bootstrap to settle so the calling spec
  // can immediately `goto(...)` and assert against rendered missions.
  await page
    .getByRole("status", { name: /loading questkit demo/i })
    .waitFor({ state: "detached", timeout: 15_000 })
    .catch(() => {
      // Already past bootstrap — swallow.
    });
}
