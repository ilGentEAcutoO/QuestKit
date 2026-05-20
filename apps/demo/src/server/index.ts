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
      // Phase 8 / TASK-003: the demo proxy is the ONLY caller that should
      // request `kind: "demo"` — upstream stamps it on the JWT, and the
      // `/v1/demo/reset` route gates the dangerous data-wipe on its
      // presence. Real customer apps that POST `/v1/auth/token` directly
      // omit `kind` and therefore cannot trip the reset.
      body: JSON.stringify({
        appId: APP_ID,
        userId,
        appSecret,
        kind: "demo",
      }),
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
