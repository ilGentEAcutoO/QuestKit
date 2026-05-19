/**
 * Provider payload → QuestKit `Event` normalisation.
 *
 * **Scope: Stripe-only for v0.1.** See plan.md amendment A27. The `_source`
 * parameter is typed as the literal `"stripe"` (not a `Provider` enum) on
 * purpose — if a future v0.2 adds a second provider, the TS compiler will
 * force every caller to be updated explicitly. Until then, the parameter is
 * unused and the signature documents the v0.1 surface.
 *
 * The shape we map from:
 *
 *   {
 *     id:       "abc123",
 *     type:     "payment_intent.succeeded",
 *     created:  1700000000,                     // unix seconds
 *     data: { object: { customer: "cus_xxx", … } }
 *   }
 *
 * Mapping (locked in the TASK-021 brief):
 *
 *   eventId          = `evt_${rawPayload.id}`         (returned in 202 response)
 *   Event.idempotencyKey = eventId                    (carried via the existing
 *                                                      `Event` shape — see note)
 *   Event.userId     = data.object.customer ?? 'anonymous'
 *   Event.name       = type
 *   Event.timestamp  = created * 1000                 (Stripe sends seconds; ms)
 *   Event.payload    = data.object
 *
 * Note on naming: the brief uses `Event.id` / `Event.eventName`, but the
 * canonical `Event` type in `@questkit/types` has `name` / `idempotencyKey`
 * (no separate `id`). Rather than fork the type, we thread the brief's
 * "eventId" through `idempotencyKey` — this is exactly the field the API
 * worker's `/v1/events` route uses for replay protection, so the queue
 * consumer (TASK-022) gets idempotency for free when it RPCs the api.
 *
 * Errors throw `NormalizationError` with a discriminated `reason` so the
 * route handler can return a precise 400 message.
 */
import type { Event } from "@questkit/types";

export type NormalizationReason =
  | "invalid_payload_root"
  | "invalid_id"
  | "invalid_type"
  | "invalid_created"
  | "invalid_data_object";

export class NormalizationError extends Error {
  override name = "NormalizationError";
  constructor(
    public reason: NormalizationReason,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

/**
 * The result the route handler needs: the QuestKit-shaped Event to enqueue,
 * plus the eventId to return in the 202 response. We return both because
 * `Event` itself has no `id` field (see the note in the file header).
 */
export interface NormalizedEvent {
  eventId: string;
  event: Event;
}

export function toEvent(
  rawPayload: unknown,
  _source: "stripe",
): NormalizedEvent {
  if (typeof rawPayload !== "object" || rawPayload === null) {
    throw new NormalizationError(
      "invalid_payload_root",
      "payload must be a JSON object",
    );
  }

  const p = rawPayload as Record<string, unknown>;

  if (typeof p.id !== "string" || p.id.length === 0) {
    throw new NormalizationError("invalid_id", "missing or non-string `id`");
  }
  if (typeof p.type !== "string" || p.type.length === 0) {
    throw new NormalizationError(
      "invalid_type",
      "missing or non-string `type`",
    );
  }
  if (typeof p.created !== "number" || !Number.isFinite(p.created)) {
    throw new NormalizationError(
      "invalid_created",
      "missing or non-numeric `created`",
    );
  }

  const data = p.data;
  if (typeof data !== "object" || data === null) {
    throw new NormalizationError(
      "invalid_data_object",
      "missing or non-object `data`",
    );
  }
  const obj = (data as Record<string, unknown>).object;
  if (typeof obj !== "object" || obj === null) {
    throw new NormalizationError(
      "invalid_data_object",
      "missing or non-object `data.object`",
    );
  }

  const objRecord = obj as Record<string, unknown>;
  const customer = objRecord.customer;
  const userId =
    typeof customer === "string" && customer.length > 0
      ? customer
      : "anonymous";

  const eventId = `evt_${p.id}`;
  const event: Event = {
    userId,
    name: p.type,
    payload: objRecord,
    timestamp: p.created * 1000,
    idempotencyKey: eventId,
  };

  return { eventId, event };
}
