/**
 * Mission-window arithmetic. Pure, UTC-only, no I/O.
 *
 * QuestKit missions have three window kinds (`MissionCriteria.window` in
 * `@questkit/types`):
 *   - "daily"    — one UTC calendar day, `00:00:00.000Z` (inclusive) to the
 *                  next `00:00:00.000Z` (exclusive).
 *   - "weekly"   — one ISO week — Monday `00:00:00.000Z` (inclusive) to the
 *                  next Monday `00:00:00.000Z` (exclusive).
 *   - "lifetime" — always `[0, +Infinity)`. The counter never resets.
 *
 * Why UTC-only? Per plan §3 amendment A9 + the TASK-009 brief: QuestKit's
 * server is a Cloudflare Worker that runs in arbitrary edge locations. Local
 * timezone math would produce different windows depending on which colo
 * served the request, which would be terrible for user-visible counters.
 *
 * Why ISO week (Mon-start) instead of US-style Sun-start? The plan §6.1 calls
 * out `weekly (ISO week start Monday UTC)` explicitly. ISO is also the
 * default for most non-US users; we accept the +5% confusion cost for
 * stronger cross-cultural defaults.
 */
import type { MissionCriteria } from "@questkit/types";

/**
 * The three values `MissionCriteria.window` can take when present.
 * Extracted from `@questkit/types` so callers don't have to repeat the union.
 */
export type WindowKind = NonNullable<MissionCriteria["window"]>;

/**
 * Compute the half-open `[startMs, endMs)` bounds of the window containing
 * `refMs`. Both values are Unix milliseconds.
 *
 * Examples (paste-friendly for the spec reader):
 *   - daily, ref = 2026-05-19T15:30:00Z  → [2026-05-19T00:00Z, 2026-05-20T00:00Z)
 *   - weekly, ref = 2026-05-24 (Sun)     → [2026-05-18T00:00Z (Mon), 2026-05-25T00:00Z)
 *   - lifetime                           → [0, Number.POSITIVE_INFINITY)
 */
export function windowBounds(
  kind: WindowKind,
  refMs: number,
): { startMs: number; endMs: number } {
  if (kind === "lifetime") {
    return { startMs: 0, endMs: Number.POSITIVE_INFINITY };
  }
  if (kind === "daily") {
    return dailyBounds(refMs);
  }
  // kind === "weekly"
  return weeklyBounds(refMs);
}

/**
 * Daily window: floor `refMs` to the UTC calendar day, end is +24h exclusive.
 *
 * We deliberately use `Date.UTC` rather than constructing a `Date` and reading
 * `.getUTCHours()` etc. — UTC math is value-based, so floor-to-day is just an
 * integer division and multiplication. No `Date` allocation, no toLocaleString.
 */
function dailyBounds(refMs: number): { startMs: number; endMs: number } {
  const DAY_MS = 86_400_000;
  // 1970-01-01T00:00:00Z aligns exactly with the UTC epoch — no offset needed.
  const startMs = Math.floor(refMs / DAY_MS) * DAY_MS;
  return { startMs, endMs: startMs + DAY_MS };
}

/**
 * Weekly window: floor `refMs` to the most recent UTC Monday at 00:00:00.000Z,
 * end is +7 days exclusive.
 *
 * Why this works: `Date.UTC(1970, 0, 1)` = Thursday 1970-01-01T00:00:00Z. The
 * UTC epoch is therefore offset from "Monday 00:00:00Z" by exactly +3 days.
 * If we shift `refMs` back by 3 days, the resulting timeline is anchored on
 * Monday at zero, and a plain mod-7-days gives us the offset within the
 * ISO week.
 *
 * Reference values for the test corpus (audited against UNIX `cal`):
 *   - 1970-01-01T00:00:00Z is a Thursday  → +3d to the prior Monday (1969-12-29).
 *   - 2026-05-18T00:00:00Z is a Monday    → offset = 0.
 */
function weeklyBounds(refMs: number): { startMs: number; endMs: number } {
  const DAY_MS = 86_400_000;
  const WEEK_MS = 7 * DAY_MS;
  // Epoch offset: Mon = (Thu - 3 days), so Thu epoch becomes Mon-anchored at
  // (refMs + 3 days). After modding, subtract the +3d to get the Monday's ms.
  const MON_ANCHOR_OFFSET = 3 * DAY_MS;
  const shifted = refMs + MON_ANCHOR_OFFSET;
  const weekOffsetMs = ((shifted % WEEK_MS) + WEEK_MS) % WEEK_MS;
  // Subtract the within-week offset from `refMs` (NOT from `shifted`) to land
  // back on the actual Monday 00:00:00Z.
  const startMs = refMs - weekOffsetMs;
  return { startMs, endMs: startMs + WEEK_MS };
}
