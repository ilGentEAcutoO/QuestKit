/**
 * Analytics Engine write helper for `/v1/events`.
 *
 * Per plan §2.5 the `EVENTS_AE` binding points at the `questkit_events`
 * dataset. We write one data-point per accepted event so the dataset doubles
 * as the ingest journal (queryable from Workers Analytics or via the
 * dashboard's SQL API).
 *
 * Schema (locked — change requires migration of any downstream SQL queries):
 *
 *   blobs    [name, userId, country, idempotencyKey ?? ""]
 *   doubles  [1 (count), lagMs (= nowMs - event.timestamp), missionsMatched]
 *   indexes  [userId]
 *
 * AE limits (Cloudflare docs):
 *   - blobs:   ≤ 20 entries, ≤ ~5 KB each, ≤ 5 KB total
 *   - doubles: ≤ 20 entries
 *   - indexes: ≤ 96 bytes (UTF-8)
 *
 * On the `indexes` ≤ 96 bytes constraint: `userId` is host-provided. We accept
 * this is a host-app responsibility — a host that picks > 96-byte ids will
 * see AE silently drop the index (or throw, depending on workerd version).
 * Documented here so the failure mode is discoverable.
 *
 * On the index cardinality: AE indexes can be HIGH-cardinality (per
 * Cloudflare docs they're sampled, not hash-bucketed). Using userId is fine —
 * the docs explicitly call out this is the intended usage pattern.
 *
 * `requestCountry` comes from `c.req.raw.cf?.country` (Hono exposes the
 * underlying Request via `c.req.raw`). If unavailable (local dev, test
 * runtime, etc.) we substitute the literal `"unknown"` so the blob slot is
 * never `null` — keeps downstream SQL pivots simpler.
 */
import type { Event } from "@questkit/types";

/**
 * Context object collected by the route handler before the AE write.
 */
export interface AEWriteContext {
  /** Cloudflare-detected country code (e.g. "US"); undefined in tests / local dev. */
  requestCountry?: string;
  /** How many missions were updated by this event (for telemetry on rule-engine output). */
  missionsMatched: number;
  /** Server-side "now" in ms, used to compute ingestion lag against event.timestamp. */
  nowMs: number;
}

/**
 * Write one data-point. Safe to call inside the route handler synchronously —
 * `writeDataPoint` is a non-blocking enqueue per Cloudflare runtime semantics.
 *
 * Never throws on its own; if the runtime rejects the shape (e.g. > 96 byte
 * index) the rejection surfaces at flush time and is dropped by AE — not
 * caught here. The route's outer try/catch keeps any such failure from
 * becoming a 500.
 */
export function writeEventDataPoint(
  ae: AnalyticsEngineDataset,
  event: Event,
  ctx: AEWriteContext,
): void {
  const lagMs = Math.max(0, ctx.nowMs - event.timestamp);
  ae.writeDataPoint({
    blobs: [
      event.name,
      event.userId,
      ctx.requestCountry ?? "unknown",
      event.idempotencyKey ?? "",
    ],
    doubles: [1, lagMs, ctx.missionsMatched],
    indexes: [event.userId],
  });
}
