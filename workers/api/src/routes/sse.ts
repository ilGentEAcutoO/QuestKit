/**
 * /v1/sse — server-sent events fanout for live SDK updates (TASK-011).
 *
 * Routes:
 *
 *   GET /v1/sse/updates
 *     Long-lived SSE stream. Each tab/connection a single user has open
 *     subscribes to its own per-user SSEHub DO; broadcasts from
 *     `routes/missions.ts` (and later routes that mutate state) fan out to
 *     all of that user's open subscribers in one shot.
 *
 * Auth:
 *   JWT Bearer via `requireAuth` middleware. `c.var.userId` is the DO key.
 *
 * Implementation:
 *   We proxy the upstream Worker response from the DO verbatim. The DO's
 *   `/subscribe` handler already returns a fully-formed SSE Response object
 *   (correct headers + a ReadableStream body); Hono passes that through
 *   without re-wrapping. The Worker's outer HTTP machinery streams the body
 *   to the client, and the DO's TransformStream remains live until the
 *   client tears the connection down - at which point the DO's
 *   `writable.closed` handler cleans up its writer reference.
 *
 * Note on EventSource:
 *   EventSource (the browser SSE client) cannot send custom headers like
 *   Authorization. The SDK's reconnect logic (TASK-012) must therefore
 *   either pass the JWT as a query param OR use a polyfill that supports
 *   headers (e.g. `event-source-polyfill`). The server side here accepts
 *   the Authorization header today; a query-param fallback can be added
 *   alongside the SDK work.
 */
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";

interface SseVars {
  userId: string;
  jti: string;
}

const sse = new Hono<{ Bindings: Env; Variables: SseVars }>();

sse.use("/*", requireAuth());

sse.get("/updates", async (c) => {
  const userId = c.var.userId;
  // One DO per user. `idFromName` is deterministic so every connection for
  // the same user lands on the same DO instance - which is the whole point
  // of using a DO here (single fan-out point for broadcasts).
  const stubId = c.env.SSE_HUB.idFromName(userId);
  const stub = c.env.SSE_HUB.get(stubId);
  // The DO's /subscribe handler returns a Response with the SSE stream body
  // already set up. We return it as-is so Hono streams the body through to
  // the client without re-wrapping (which would buffer it).
  return stub.fetch("https://_/subscribe");
});

export default sse;
