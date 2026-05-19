/**
 * questkit-worker-webhook-relay — public-facing inbound webhook receiver.
 *
 * Pipeline (per TASK-021):
 *   POST /v1/webhook/incoming
 *     1) read raw body (HMAC verifies over raw bytes, not parsed JSON)
 *     2) verify `Stripe-Signature` against `env.WEBHOOK_HMAC_SECRET`
 *     3) parse JSON → throw 400 invalid_json on syntax error
 *     4) normalize → QuestKit `Event` (throws NormalizationError → 400)
 *     5) `env.WEBHOOK_QUEUE.send(event)` → 202 `{accepted, eventId}`
 *
 * Failure modes are explicit on the wire:
 *   - 400 malformed_signature   (header missing pieces / wrong shape)
 *   - 400 invalid_json          (body not parseable JSON)
 *   - 400 invalid_payload_*     (body parsed but wrong shape — see normalize.ts)
 *   - 401 invalid_signature     (HMAC mismatch)
 *   - 401 signature_expired     (timestamp outside ±300s skew)
 *
 * Constraints from the brief:
 *   - No rate limiting here — that's the API worker's job (DO RateLimiter).
 *   - No DLQ binding — DLQ is configured on the consumer's wrangler config
 *     (TASK-022), not the producer's.
 *   - No AI / D1 / KV bindings — relay is intentionally minimal so the cold
 *     start stays fast under public-internet load.
 */
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verify } from "./hmac";
import { NormalizationError, toEvent } from "./normalize";

const app = new Hono<{ Bindings: Env }>();

app.get("/v1/health", (c) => {
  return c.json({ ok: true, service: "webhook-relay" });
});

app.post("/v1/webhook/incoming", async (c) => {
  // Raw bytes — HMAC over `${t}.${rawBody}` must match what the sender signed,
  // which means whitespace and key order in the JSON are load-bearing.
  const rawBody = await c.req.text();
  const sigHeader = c.req.header("stripe-signature") ?? "";

  const sigResult = await verify(rawBody, sigHeader, c.env.WEBHOOK_HMAC_SECRET);
  if (!sigResult.ok) {
    const status = sigResult.reason === "malformed_signature" ? 400 : 401;
    return c.json({ error: sigResult.reason }, status);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  let normalized: ReturnType<typeof toEvent>;
  try {
    normalized = toEvent(parsed, "stripe");
  } catch (err) {
    if (err instanceof NormalizationError) {
      return c.json({ error: err.reason }, 400);
    }
    throw err;
  }

  await c.env.WEBHOOK_QUEUE.send(normalized.event);

  return c.json({ accepted: true, eventId: normalized.eventId }, 202);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }
  console.error("[webhook-relay] unhandled", err);
  return c.json({ error: "internal_error" }, 500);
});

export default app;
