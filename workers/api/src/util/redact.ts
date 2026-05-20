/**
 * Log-safety helpers for the QuestKit Worker API.
 *
 * Closes security-review §3.8 A3 — a small safety net to prevent any future
 * `console.warn` / `console.error` call from leaking a full user identifier
 * into Workers Logs, `wrangler tail`, or any downstream observability sink.
 *
 * Today's call sites do NOT embed userIds in their message strings (every
 * `console.warn` in `routes/` and `services/` either logs a fixed string +
 * status code, or logs `err` as a discrete argument). Introducing this helper
 * NOW — with a unit test that locks the contract — gives reviewers and future
 * contributors a one-line redaction primitive to reach for the moment any log
 * does start carrying an id.
 */

/**
 * Redact a user-id for safe logging.
 *
 * Returns a deterministic, debuggable digest of the input:
 *   - For ids of length ≥ 8, returns `first 4 chars + "…" + last 2 chars` so
 *     operators can correlate "same user across two log lines" without ever
 *     seeing the full identifier.
 *   - For ids of length < 8, returns the fixed sentinel `"***"`. Doing a
 *     partial reveal on tiny ids would amount to leaking most of the value,
 *     so we collapse them entirely.
 *
 * The helper is pure and synchronous; safe to call inside any log path.
 */
export function redactId(id: string): string {
  if (id.length < 8) return "***";
  return `${id.slice(0, 4)}…${id.slice(-2)}`;
}
