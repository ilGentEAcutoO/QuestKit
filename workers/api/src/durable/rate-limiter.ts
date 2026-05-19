/**
 * Per-JWT sliding-window rate limiter (Durable Object, SQLite-backed).
 *
 * Why a Durable Object?
 *   - Single-writer guarantee per `idFromName(userId)` — we never have to worry
 *     about races on the `hits` table because all reads/writes for one user
 *     funnel through one DO instance.
 *   - SQLite-DO storage gives us a transactional, persistent table for free
 *     (zero-cost on hibernation, survives restarts within retention).
 *
 * Algorithm: classic sliding window with a discrete log table — for each hit
 * we INSERT a timestamp row, then a check counts rows where `ts >= now - W`.
 * The naive list-of-timestamps memory footprint is bounded because we
 * garbage-collect rows older than the window on every check, so the table
 * stays at most ~ limit rows.
 *
 * The DO class name MUST remain "RateLimiter" — `wrangler.jsonc` references it
 * by exact string in both `migrations[].new_sqlite_classes` and
 * `durable_objects.bindings`.
 *
 * HTTP surface (consumer = routes/events.ts):
 *
 *   GET /check?limit=100&window=60000
 *     200 {"ok":true,"remaining":N}         - allowed (incremented)
 *     429 {"ok":false,"retryAfterMs":N}     - rejected, with RFC-7231
 *                                              Retry-After header in seconds
 *     404 "not_found"                       - unknown path
 *
 * `routes/events.ts` checks the status code (200 vs 429) for the allow/reject
 * decision and reads the body for diagnostics. We return a real 429 instead
 * of `200 {ok:false}` because the existing route is wired to inspect status —
 * see "Important: HTTP response shape" in TASK-011 brief.
 */
import { DurableObject } from "cloudflare:workers";

/**
 * Internal result of `check()`. The HTTP layer wraps this into the right
 * status code; direct callers (tests via `runInDurableObject`) read the
 * struct verbatim.
 */
export interface RateLimiterCheckResult {
  /** True when the request is allowed (and counted); false when over the limit. */
  ok: boolean;
  /** How many additional requests fit in the current window after this one. */
  remaining: number;
  /**
   * When `ok === false`, the soonest time (in ms) the caller can retry. This
   * is the gap between `now` and the oldest hit's window expiry, i.e. when
   * the window slides far enough to leave space.
   */
  retryAfterMs?: number;
}

/**
 * Row shape returned by the COUNT query. SQLite-DO returns integers as
 * `number` (not bigint) for COUNT(*) so the cast is safe.
 *
 * `SqlStorage.exec<T>` constrains T to `Record<string, SqlStorageValue>`.
 * Plain interfaces don't get an implicit index signature, so we declare an
 * explicit one alongside the typed key — TypeScript is happy and the
 * eslint `consistent-type-definitions: ["interface"]` rule is satisfied.
 */
interface CountRow extends Record<string, SqlStorageValue> {
  n: number;
}

/**
 * Row shape for `SELECT MIN(ts)` - may be null if the table is empty, but
 * the branch that reads `oldest` only runs when count >= limit > 0, so the
 * row always exists at runtime. Same `extends Record` rationale as above.
 */
interface OldestRow extends Record<string, SqlStorageValue> {
  ts: number;
}

export class RateLimiter extends DurableObject<Env> {
  /**
   * The constructor runs once per cold DO start. We use it to ensure the
   * SQLite schema exists. `CREATE TABLE IF NOT EXISTS` is idempotent, so this
   * is safe on every wake.
   *
   * SQL note: SQLite supports multi-statement exec; the two statements share
   * a single `exec()` call. The index speeds up the window-count query
   * (`WHERE ts >= ?`) which dominates the path.
   */
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS hits (ts INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_hits_ts ON hits(ts);
    `);
  }

  /**
   * HTTP entry point - only `/check` is meaningful. Returns 404 for anything
   * else so a misrouted call fails loudly rather than silently allowing.
   *
   * Query params:
   *   limit   - max hits inside the window (default 100, matches plan §2.5)
   *   window  - window size in ms (default 60000 = 60s, matches plan §2.5)
   *
   * Defaults are deliberately wide (allow on parse-failure) because the
   * caller is expected to always pass both - if the caller is buggy and
   * omits them, the worst case is "limiter is too generous", not "DoS".
   */
  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/check") {
      const limitParam = url.searchParams.get("limit");
      const windowParam = url.searchParams.get("window");
      const limit = limitParam !== null ? Number.parseInt(limitParam, 10) : 100;
      const windowMs =
        windowParam !== null ? Number.parseInt(windowParam, 10) : 60_000;
      // Defensive: NaN → fallback. Pool-workers gives us synchronous URL
      // parsing so this path is hot - avoid throwing on bad input.
      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 100;
      const safeWindow =
        Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 60_000;

      const result = this.check(safeLimit, safeWindow);
      if (!result.ok) {
        // RFC 7231 §7.1.3: Retry-After is in seconds (whole-number HTTP-date
        // OR delta-seconds). Round up so the client doesn't retry one tick
        // too early.
        const retryAfterSec = Math.ceil((result.retryAfterMs ?? 1000) / 1000);
        return new Response(
          JSON.stringify({
            ok: false,
            retryAfterMs: result.retryAfterMs,
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": String(retryAfterSec),
            },
          },
        );
      }
      return Response.json(result);
    }
    return new Response("not_found", { status: 404 });
  }

  /**
   * Direct check entry - synchronous wrt SQL since SQLite-DO's `exec` is
   * synchronous. Exposed so unit tests using `runInDurableObject` can drive
   * the algorithm without going through HTTP.
   *
   * Algorithm:
   *   1. Garbage-collect any hit older than the window (defence against the
   *      table growing unbounded under sustained pressure).
   *   2. Count hits inside the window.
   *   3. If count >= limit → reject + compute `retryAfterMs` from the oldest
   *      surviving hit's age.
   *   4. Otherwise → record this hit, return remaining capacity.
   *
   * Concurrency: we rely on the single-writer guarantee of a DO. Two
   * concurrent calls within the same DO are serialised by the runtime, so
   * "read then write" can't race.
   */
  check(limit: number, windowMs: number): RateLimiterCheckResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    // GC: drop rows that fell out of the window. Keeps the table at ~ limit
    // rows in the steady state.
    this.ctx.storage.sql.exec("DELETE FROM hits WHERE ts < ?", windowStart);

    // Count hits currently inside the window.
    const countRow = this.ctx.storage.sql
      .exec<CountRow>(
        "SELECT COUNT(*) AS n FROM hits WHERE ts >= ?",
        windowStart,
      )
      .one();
    const n = countRow.n;

    if (n >= limit) {
      // Over the limit - find the oldest in-window hit and compute when the
      // window will slide enough to free a slot. The `MIN(ts)` row is
      // guaranteed to exist because n >= limit >= 1.
      const oldestRow = this.ctx.storage.sql
        .exec<OldestRow>(
          "SELECT MIN(ts) AS ts FROM hits WHERE ts >= ?",
          windowStart,
        )
        .one();
      // retry-after = "when does the oldest hit leave the window?" - that's
      // `oldest.ts + windowMs`. The gap from `now` is the retry delay.
      // Clamp to at least 1ms so the caller never sees a non-positive
      // retryAfter (which would imply "retry now", contradicting the 429).
      const retryAfterMs = Math.max(1, oldestRow.ts + windowMs - now);
      return { ok: false, remaining: 0, retryAfterMs };
    }

    // Allow + record. The INSERT happens AFTER the count so the new hit is
    // not double-counted on this call's response.
    this.ctx.storage.sql.exec("INSERT INTO hits (ts) VALUES (?)", now);
    return { ok: true, remaining: limit - n - 1 };
  }
}
