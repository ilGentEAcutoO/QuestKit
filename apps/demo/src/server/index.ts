/**
 * questkit-worker-demo — server-side router.
 *
 * The wrangler config sets `run_worker_first: ["/api/*"]`, so this router
 * sees ONLY /api/* requests; everything else hits the [assets] binding
 * directly. We keep the surface tiny: one endpoint, one purpose.
 *
 * POST /api/token
 *   - Body: { userId: string }
 *   - Calls the upstream api worker with appId="demo" + APP_SECRET (from
 *     wrangler secrets) so the secret never reaches the browser.
 *   - Returns the minted JWT shape verbatim: { token, expiresAt }.
 */
import { Hono } from "hono";

/**
 * Cloudflare Workers Fetcher interface — minimal subset we depend on. The
 * full type lives in @cloudflare/workers-types but we avoid pulling that
 * dep into the demo package; the runtime guarantees this shape on the
 * static-asset binding.
 */
interface Fetcher {
  fetch: (request: Request) => Promise<Response>;
}

interface Env {
  APP_SECRET: string;
  ASSETS_BINDING: Fetcher;
}

interface MintRequest {
  userId?: string;
}

const UPSTREAM_AUTH_URL = "https://api.questkit.jairukchan.com/v1/auth/token";
const APP_ID = "demo";
/**
 * Fail-fast deadline for the upstream `/v1/auth/token` hop (TASK-005,
 * v0.1.4). Intentionally tighter than the browser's 10s budget for the
 * `/api/token` round trip — that way the demo worker surfaces a
 * `upstream_unreachable` 502 to the browser before the browser's own
 * timeout fires, giving the user a clear "auth upstream is sad" signal
 * instead of a generic browser-side timeout.
 */
const UPSTREAM_TIMEOUT_MS = 8_000;

const app = new Hono<{ Bindings: Env }>();

app.post("/api/token", async (c) => {
  let body: MintRequest;
  try {
    body = await c.req.json<MintRequest>();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const { userId } = body;
  if (typeof userId !== "string" || userId.length === 0) {
    return c.json({ error: "missing_userId" }, 400);
  }
  // Light defence-in-depth: cap userId length so a bad caller can't pump
  // arbitrary-size strings into the upstream call.
  if (userId.length > 256) {
    return c.json({ error: "invalid_userId" }, 400);
  }

  const appSecret = c.env.APP_SECRET;
  if (typeof appSecret !== "string" || appSecret.length === 0) {
    return c.json({ error: "demo_misconfigured" }, 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM_AUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: APP_ID, userId, appSecret }),
      // Defense-in-depth (TASK-005): bail out before the Workers Runtime
      // request budget runs out. A timeout here surfaces the same
      // `upstream_unreachable` shape as a network-level failure, so the
      // browser path treats them identically.
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return c.json({ error: "upstream_unreachable" }, 502);
  }

  if (!upstream.ok) {
    return c.json({ error: "upstream_auth_failed" }, 502);
  }

  // Forward the upstream JSON verbatim — { token, expiresAt }.
  const payload = await upstream.json();
  return c.json(payload, 200);
});

// Any other /api/* path → 404. The Worker is otherwise a static-asset host.
app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));

export default app;
