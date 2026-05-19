/**
 * /v1/webhook/incoming integration tests — TDD-first.
 *
 * These run inside the workerd test runtime; `SELF` is the bound Worker
 * (i.e. `src/index.ts`'s default export). `env` exposes the queue producer
 * (`WEBHOOK_QUEUE`) and the secret (`WEBHOOK_HMAC_SECRET`) per vitest.config.ts.
 *
 * The route pipeline under test:
 *   1. Read raw body (HMAC must verify over raw bytes — not parsed JSON)
 *   2. Verify `Stripe-Signature` header against `env.WEBHOOK_HMAC_SECRET`
 *   3. Normalize Stripe payload → QuestKit Event
 *   4. Enqueue to `WEBHOOK_QUEUE`
 *   5. Return 202 `{ accepted: true, eventId }`
 *
 * On failure: malformed sig → 400, invalid sig / expired → 401, bad shape →
 * 400. No enqueue happens on any failure path.
 */
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "test_webhook_hmac_secret_do_not_use_in_prod_only_for_vitest";

/**
 * Sign a body the way our `verify` (and Stripe) expect:
 * `t=<unix-seconds>,v1=<hex-sha256-of-${t}.${body}>`.
 */
async function signHeader(rawBody: string, t: number, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${t}.${rawBody}`),
    ),
  );
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${t},v1=${hex}`;
}

function stripeBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    type: "payment_intent.succeeded",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "pi_xxx",
        amount: 2000,
        currency: "usd",
        customer: "cus_xxx",
      },
    },
    ...overrides,
  };
}

function post(body: string, headers: Record<string, string> = {}) {
  return SELF.fetch("https://relay.test/v1/webhook/incoming", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

describe("get /v1/health", () => {
  it("returns 200 with service identity", async () => {
    const res = await SELF.fetch("https://relay.test/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: "webhook-relay" });
  });
});

describe("post /v1/webhook/incoming — happy path", () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendSpy = vi.spyOn(env.WEBHOOK_QUEUE, "send");
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it("returns 202 + {accepted, eventId} when sig is valid and body parses", async () => {
    const body = stripeBody();
    const raw = JSON.stringify(body);
    const header = await signHeader(raw, body.created as number, SECRET);

    const res = await post(raw, { "stripe-signature": header });
    expect(res.status).toBe(202);
    const json = (await res.json()) as { accepted: boolean; eventId: string };
    expect(json.accepted).toBe(true);
    expect(json.eventId).toBe("evt_abc123");
  });

  it("enqueues the normalized event to WEBHOOK_QUEUE exactly once", async () => {
    const body = stripeBody({ id: "queue_check" });
    const raw = JSON.stringify(body);
    const header = await signHeader(raw, body.created as number, SECRET);

    await post(raw, { "stripe-signature": header });

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const enqueued = sendSpy.mock.calls[0]?.[0] as {
      userId: string;
      name: string;
      timestamp: number;
      payload: Record<string, unknown>;
      idempotencyKey: string;
    };
    expect(enqueued.userId).toBe("cus_xxx");
    expect(enqueued.name).toBe("payment_intent.succeeded");
    expect(enqueued.idempotencyKey).toBe("evt_queue_check");
    expect(typeof enqueued.timestamp).toBe("number");
  });
});

describe("post /v1/webhook/incoming — auth failures (no enqueue)", () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendSpy = vi.spyOn(env.WEBHOOK_QUEUE, "send");
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it("returns 401 invalid_signature on a tampered hex", async () => {
    const body = stripeBody();
    const raw = JSON.stringify(body);
    const t = body.created as number;
    const header = `t=${t},v1=${"0".repeat(64)}`;

    const res = await post(raw, { "stripe-signature": header });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "invalid_signature" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 401 signature_expired when the timestamp is too old", async () => {
    const body = stripeBody();
    const raw = JSON.stringify(body);
    // Sign with a timestamp 1 hour in the past; default tolerance is 5 min.
    const t = Math.floor(Date.now() / 1000) - 3_600;
    const header = await signHeader(raw, t, SECRET);

    const res = await post(raw, { "stripe-signature": header });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "signature_expired" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 400 malformed_signature when header is missing pieces", async () => {
    const raw = JSON.stringify(stripeBody());

    const res = await post(raw, { "stripe-signature": "v1=abcdef" });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "malformed_signature" });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 400 malformed_signature when the Stripe-Signature header is absent", async () => {
    const raw = JSON.stringify(stripeBody());

    const res = await post(raw);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "malformed_signature" });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe("post /v1/webhook/incoming — body shape failures", () => {
  let sendSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    sendSpy = vi.spyOn(env.WEBHOOK_QUEUE, "send");
  });

  afterEach(() => {
    sendSpy.mockRestore();
  });

  it("returns 400 invalid_payload when the body fails Stripe-shape validation", async () => {
    const raw = JSON.stringify({ foo: "bar" });
    const t = Math.floor(Date.now() / 1000);
    const header = await signHeader(raw, t, SECRET);

    const res = await post(raw, { "stripe-signature": header });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/^invalid_/),
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_json when the body is not parseable JSON", async () => {
    const raw = "{not_valid_json";
    const t = Math.floor(Date.now() / 1000);
    const header = await signHeader(raw, t, SECRET);

    const res = await post(raw, { "stripe-signature": header });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_json" });
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
