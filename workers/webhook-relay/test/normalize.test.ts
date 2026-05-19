/**
 * normalize.ts unit tests — pure function, no `cloudflare:test` env.
 *
 * Covers the Stripe → QuestKit `Event` mapping locked in TASK-021. The brief's
 * "Event.id" and "Event.eventName" map onto the existing `Event` shape's
 * `idempotencyKey` and `name` fields respectively — see `normalize.ts` header
 * for the rationale. `toEvent` returns `{ eventId, event }` so the route can
 * 202-response the id without re-deriving it.
 *
 * Bad-shape inputs must throw `NormalizationError({reason})` (discriminated
 * so the route can translate to a 400 with a precise message).
 */
import { describe, expect, it } from "vitest";
import { NormalizationError, toEvent } from "../src/normalize";

const validStripePayload = {
  id: "abc123",
  type: "payment_intent.succeeded",
  created: 1_700_000_000,
  data: {
    object: {
      id: "pi_xxx",
      amount: 2000,
      currency: "usd",
      customer: "cus_xxx",
    },
  },
};

describe("normalize.toEvent — happy path", () => {
  it("maps a fully-populated Stripe payload to a QuestKit Event", () => {
    const { eventId, event } = toEvent(validStripePayload, "stripe");
    expect(eventId).toBe("evt_abc123");
    expect(event).toEqual({
      userId: "cus_xxx",
      name: "payment_intent.succeeded",
      timestamp: 1_700_000_000_000,
      payload: validStripePayload.data.object,
      idempotencyKey: "evt_abc123",
    });
  });

  it("falls back to userId='anonymous' when `data.object.customer` is missing", () => {
    const payload = {
      ...validStripePayload,
      data: { object: { id: "pi_xxx", amount: 2000 } },
    };
    const { event } = toEvent(payload, "stripe");
    expect(event.userId).toBe("anonymous");
  });

  it("multiplies `created` by 1000 to convert seconds → milliseconds", () => {
    const { event } = toEvent(validStripePayload, "stripe");
    expect(event.timestamp).toBe(validStripePayload.created * 1000);
  });

  it("prefixes the event id with `evt_` even when the source id is already prefixed", () => {
    const { eventId, event } = toEvent(
      { ...validStripePayload, id: "evt_already_prefixed" },
      "stripe",
    );
    // We always prefix verbatim — the spec says `evt_${rawPayload.id}`.
    expect(eventId).toBe("evt_evt_already_prefixed");
    expect(event.idempotencyKey).toBe("evt_evt_already_prefixed");
  });
});

describe("normalize.toEvent — error cases", () => {
  it("throws NormalizationError when payload is not an object", () => {
    expect(() => toEvent(null, "stripe")).toThrow(NormalizationError);
    expect(() => toEvent("string", "stripe")).toThrow(NormalizationError);
    expect(() => toEvent(42, "stripe")).toThrow(NormalizationError);
  });

  it("throws NormalizationError when `id` is missing or empty", () => {
    const { id: _id, ...rest } = validStripePayload;
    void _id;
    expect(() => toEvent(rest, "stripe")).toThrow(NormalizationError);
    expect(() => toEvent({ ...validStripePayload, id: "" }, "stripe")).toThrow(
      NormalizationError,
    );
  });

  it("throws NormalizationError when `type` is missing", () => {
    const { type: _type, ...rest } = validStripePayload;
    void _type;
    expect(() => toEvent(rest, "stripe")).toThrow(NormalizationError);
  });

  it("throws NormalizationError when `created` is missing or non-numeric", () => {
    expect(() =>
      toEvent({ ...validStripePayload, created: "not_a_number" }, "stripe"),
    ).toThrow(NormalizationError);
    const { created: _created, ...rest } = validStripePayload;
    void _created;
    expect(() => toEvent(rest, "stripe")).toThrow(NormalizationError);
  });

  it("throws NormalizationError when `data.object` is missing", () => {
    expect(() =>
      toEvent({ ...validStripePayload, data: {} }, "stripe"),
    ).toThrow(NormalizationError);
    expect(() =>
      toEvent({ ...validStripePayload, data: null }, "stripe"),
    ).toThrow(NormalizationError);
  });

  it("surfaces the `reason` on the thrown error so the route can branch", () => {
    try {
      toEvent(null, "stripe");
      throw new Error("expected toEvent to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(NormalizationError);
      expect((err as NormalizationError).reason).toMatch(/^invalid_/);
    }
  });
});
