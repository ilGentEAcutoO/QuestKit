/**
 * Filter matching for `MissionCriteria.filter`. Pure, no I/O.
 *
 * `FilterClause` from `@questkit/types` is a discriminated union:
 *
 *   ```ts
 *   type FilterClause =
 *     | { eq:  unknown }
 *     | { gte: number }
 *     | { lte: number }
 *     | { gt:  number }
 *     | { lt:  number }
 *     | { in:  unknown[] };
 *   ```
 *
 * A `MissionCriteria.filter` is a `Record<string, FilterClause>` interpreted
 * as logical AND across keys: every (key, clause) pair must hold against the
 * event payload.
 *
 * ## Equality semantics
 *
 * `eq` and `in` use **structural** equality so that:
 *   - primitives match by value (`Object.is` semantics for NaN, +0/-0),
 *   - arrays and plain objects match by deep value (via `JSON.stringify`).
 *
 * Using `JSON.stringify` is documented and accepted: it can't tell
 * `undefined` apart from a missing field, but `FilterClause.in` values come
 * from the mission criteria (which we control) and event payloads are
 * `Record<string, unknown>` so `undefined` values don't typically appear in
 * the JSON anyway. The simplicity wins for v0.1.
 *
 * ## Type defensiveness
 *
 * Numeric comparators (`gte`/`lte`/`gt`/`lt`) require the value to be
 * `typeof number` and finite (NaN explicitly rejected). String-encoded
 * numbers do NOT coerce — `{"gte":50}` against `"50"` returns `false`.
 * Explicit is safer than convenient at the rule-engine boundary.
 *
 * Unknown / malformed clause shapes return `false` (never throw) so a
 * broken mission criteria can't crash event ingestion.
 */
import type { FilterClause } from "@questkit/types";

/**
 * Match a single `FilterClause` against a payload `value`.
 *
 * Returns `false` on any of:
 *   - clause is null/undefined/non-object,
 *   - clause shape doesn't match any known variant,
 *   - clause variant requires a number and `value` isn't a finite number,
 *   - structural compare returns false.
 *
 * Never throws.
 */
export function matchesClause(clause: FilterClause, value: unknown): boolean {
  if (clause === null || typeof clause !== "object") return false;

  if ("eq" in clause) {
    return deepEqual(clause.eq, value);
  }
  if ("gte" in clause) {
    return isFiniteNumber(value) && value >= clause.gte;
  }
  if ("lte" in clause) {
    return isFiniteNumber(value) && value <= clause.lte;
  }
  if ("gt" in clause) {
    return isFiniteNumber(value) && value > clause.gt;
  }
  if ("lt" in clause) {
    return isFiniteNumber(value) && value < clause.lt;
  }
  if ("in" in clause) {
    if (!Array.isArray(clause.in)) return false;
    return clause.in.some((v) => deepEqual(v, value));
  }
  return false;
}

/**
 * Match a full filter object (logical AND across keys) against an event
 * payload.
 *
 * Special cases:
 *   - `filter === undefined` → true (no constraints).
 *   - `filter === {}`         → true (no constraints).
 *   - any key missing from `payload` → false (we DO NOT treat missing fields
 *     as "no constraint"; the host must supply every filtered field for the
 *     match to succeed).
 */
export function matchesFilter(
  filter: Record<string, FilterClause> | undefined,
  payload: Record<string, unknown>,
): boolean {
  if (filter === undefined) return true;
  // Use Object.keys instead of `for...in` to skip inherited properties.
  const keys = Object.keys(filter);
  if (keys.length === 0) return true;
  for (const key of keys) {
    const clause = filter[key];
    if (clause === undefined) continue; // defensive; shouldn't happen
    // Use a direct property check so a payload field explicitly set to
    // `undefined` is treated the same as a missing one (no information value).
    if (!(key in payload)) return false;
    if (!matchesClause(clause, payload[key])) return false;
  }
  return true;
}

// -----------------------------------------------------------------------------
// internals
// -----------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Deep structural equality.
 *
 * Strategy:
 *   - identical reference / Object.is for primitives → true.
 *   - both arrays / both plain objects → JSON.stringify both sides and
 *     compare; canonicalise key order so `{a:1,b:2}` === `{b:2,a:1}`.
 *
 * Caveats (documented, acceptable for v0.1):
 *   - cannot tell `undefined` from "missing property" (JSON drops undefined).
 *   - cycles would throw; mission filters and event payloads are flat JSON
 *     so this never arises in practice.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;
  return canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  // Plain object — sort keys for canonical ordering.
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const inner = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",");
  return `{${inner}}`;
}
