/**
 * Typed D1 query helpers for QuestKit.
 *
 * Every helper accepts the `D1Database` binding (from `c.env.DB`) as the
 * first argument so the layer stays pure data-access — no Hono context, no
 * env coupling. Routes layer composes these with auth, rate-limiting, etc.
 *
 * ## Security
 * Per plan §5: every query is built with `db.prepare(...).bind(...)`. There
 * is no string concatenation of user-provided values anywhere in this file.
 * This is a hard rule because D1 prepared statements are our only defense
 * against SQL injection.
 *
 * ## Row shape contract
 * The `rowToX` parsers do `JSON.parse` on the `*_json` columns and assert
 * the result matches the domain type from `@questkit/types`. The writers in
 * this same file (or future writers in route handlers) are the only place
 * those JSON columns are written, so the shape contract holds end-to-end.
 * The CHECK constraints in `0001_init.sql` guard the discriminator columns
 * (status, currency, etc.) at the DB layer.
 *
 * ## Pagination
 * `listMissions` uses an opaque base64url cursor that encodes the last
 * returned mission's id. Decode reveals the id; the next page is
 * `WHERE id > :cursor ORDER BY id`. This is simple, total-order stable, and
 * doesn't require a timestamp column on the missions table. JSDoc on each
 * function documents the cursor shape so callers don't have to read source.
 */

import type {
  Balance,
  Campaign,
  CampaignTheme,
  CurrencyCode,
  Event,
  Mission,
  MissionCriteria,
  MissionProgress,
  Reward,
} from "@questkit/types";

// -----------------------------------------------------------------------------
// Row → domain mappers
// -----------------------------------------------------------------------------

/**
 * Internal row shapes mirror the D1 column layout. They're kept private to
 * this file so callers can't accidentally depend on snake_case names —
 * everything that escapes this module is in the camelCase shape from
 * @questkit/types.
 */
interface MissionRow {
  id: string;
  title: string;
  description: string;
  criteria_json: string;
  reward_json: string;
  campaign_id: string | null;
  expires_at: number | null;
  icon_url: string | null;
}

interface CampaignRow {
  id: string;
  title: string;
  description: string;
  start_at: number;
  end_at: number;
  theme_json: string;
  banner_url: string | null;
}

interface MissionProgressRow {
  user_id: string;
  mission_id: string;
  status: MissionProgress["status"];
  progress: number;
  current_count: number;
  target_count: number;
  updated_at: number;
}

interface BalanceRow {
  user_id: string;
  currency: string;
  amount: number;
  updated_at: number;
}

interface EventRow {
  id: string;
  user_id: string;
  name: string;
  payload_json: string;
  timestamp: number;
  idempotency_key: string | null;
}

/**
 * Parse a JSON column. We trust the shape because:
 *   1) every writer in this file (and future route writers) serialises a
 *      typed object from @questkit/types via JSON.stringify,
 *   2) the CHECK constraints in 0001_init.sql lock discriminator columns,
 *   3) the seed migration's literal JSON was reviewed manually.
 * If a future change breaks (2) we'd want to validate with zod here, but for
 * v0.1 the cost would outweigh the benefit.
 */
function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export function rowToMission(row: unknown): Mission {
  const r = row as MissionRow;
  const mission: Mission = {
    id: r.id,
    title: r.title,
    description: r.description,
    criteria: parseJson<MissionCriteria>(r.criteria_json),
    reward: parseJson<Reward>(r.reward_json),
  };
  if (r.campaign_id !== null) mission.campaignId = r.campaign_id;
  if (r.expires_at !== null) mission.expiresAt = r.expires_at;
  if (r.icon_url !== null) mission.iconUrl = r.icon_url;
  return mission;
}

export function rowToCampaign(row: unknown): Campaign {
  const r = row as CampaignRow & { mission_ids?: string };
  const campaign: Campaign = {
    id: r.id,
    title: r.title,
    description: r.description,
    startAt: r.start_at,
    endAt: r.end_at,
    // missionIds is hydrated separately via the campaign_missions junction.
    // We default to empty here; getCampaign / listCampaigns fill it in.
    missionIds: r.mission_ids
      ? (r.mission_ids.split(",").filter(Boolean) as string[])
      : [],
  };
  const theme = parseJson<CampaignTheme>(r.theme_json);
  if (theme && Object.keys(theme).length > 0) campaign.theme = theme;
  if (r.banner_url !== null && r.banner_url !== undefined)
    campaign.bannerUrl = r.banner_url;
  return campaign;
}

export function rowToMissionProgress(row: unknown): MissionProgress {
  const r = row as MissionProgressRow;
  return {
    userId: r.user_id,
    missionId: r.mission_id,
    status: r.status,
    progress: r.progress,
    currentCount: r.current_count,
    targetCount: r.target_count,
    updatedAt: r.updated_at,
  };
}

export function rowToBalance(row: unknown): Balance {
  const r = row as BalanceRow;
  return {
    userId: r.user_id,
    currency: r.currency as CurrencyCode,
    amount: r.amount,
    updatedAt: r.updated_at,
  };
}

export function rowToEvent(row: unknown): Event {
  const r = row as EventRow;
  const event: Event = {
    userId: r.user_id,
    name: r.name,
    payload: parseJson<Record<string, unknown>>(r.payload_json),
    timestamp: r.timestamp,
  };
  if (r.idempotency_key !== null) event.idempotencyKey = r.idempotency_key;
  return event;
}

// -----------------------------------------------------------------------------
// Users
// -----------------------------------------------------------------------------

/**
 * Idempotently create a `users` row for an opaque host-provided id. Per
 * TASK-006's note (a), this MUST be called before any downstream row
 * (mission_progress / balances / events) references the user — those tables
 * declare FK constraints to `users.id` and even though D1 leaves FK
 * enforcement off by default, future-proofing for `PRAGMA foreign_keys = ON`
 * is worthwhile.
 *
 * `INSERT OR IGNORE` is the correct primitive — it's a single-statement
 * upsert with no `excluded.*` cost since we don't touch existing rows.
 */
export async function ensureUser(
  db: D1Database,
  userId: string,
): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO users (id, created_at) VALUES (?1, ?2)")
    .bind(userId, Date.now())
    .run();
}

// -----------------------------------------------------------------------------
// Cursor (opaque base64url id)
// -----------------------------------------------------------------------------

/**
 * Cursor format: base64url-encoded UTF-8 of the last returned id.
 * Opaque to callers; documented here for future maintainers.
 */
function encodeCursor(id: string): string {
  // base64url — Workers runtime has globalThis.btoa for the base64 step,
  // then we swap to URL-safe alphabet and strip padding.
  const b64 = btoa(unescape(encodeURIComponent(id)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(cursor: string): string {
  const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return decodeURIComponent(escape(atob(padded)));
}

// -----------------------------------------------------------------------------
// Missions
// -----------------------------------------------------------------------------

export async function getMission(
  db: D1Database,
  id: string,
): Promise<Mission | null> {
  const row = await db
    .prepare(
      `SELECT id, title, description, criteria_json, reward_json,
              campaign_id, expires_at, icon_url
         FROM missions
        WHERE id = ?1`,
    )
    .bind(id)
    .first<MissionRow>();
  return row ? rowToMission(row) : null;
}

/**
 * List missions, optionally filtered by `campaignId`. Pagination is forward-only
 * via an opaque cursor that encodes the last id returned in the previous page.
 *
 * `opts.limit` defaults to 50 (max 100); `opts.cursor` is the base64url cursor
 * returned as `nextCursor` by a previous call.
 */
export async function listMissions(
  db: D1Database,
  opts: { campaignId?: string; limit?: number; cursor?: string } = {},
): Promise<{ missions: Mission[]; nextCursor?: string }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const cursorId = opts.cursor ? decodeCursor(opts.cursor) : null;

  // Build the query without string-concat'ing user values — we only template
  // the WHERE clause shape, never the values themselves.
  const wheres: string[] = [];
  const binds: (string | number)[] = [];
  if (opts.campaignId !== undefined) {
    wheres.push(`campaign_id = ?${binds.length + 1}`);
    binds.push(opts.campaignId);
  }
  if (cursorId !== null) {
    wheres.push(`id > ?${binds.length + 1}`);
    binds.push(cursorId);
  }
  const whereSql = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

  // Fetch limit+1 to detect "has next page" without a second COUNT query.
  binds.push(limit + 1);
  const limitIdx = binds.length;

  const sql = `
    SELECT id, title, description, criteria_json, reward_json,
           campaign_id, expires_at, icon_url
      FROM missions
      ${whereSql}
     ORDER BY id ASC
     LIMIT ?${limitIdx}
  `;

  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<MissionRow>();

  const missions = results.slice(0, limit).map(rowToMission);
  const hasMore = results.length > limit;
  const last = missions[missions.length - 1];
  if (!hasMore || last === undefined) {
    return { missions };
  }
  return { missions, nextCursor: encodeCursor(last.id) };
}

// -----------------------------------------------------------------------------
// Campaigns
// -----------------------------------------------------------------------------

/**
 * Fetch a campaign with its `missionIds` hydrated from the junction table in
 * a single round-trip (group_concat).
 */
export async function getCampaign(
  db: D1Database,
  id: string,
): Promise<Campaign | null> {
  const row = await db
    .prepare(
      `SELECT c.id,
              c.title,
              c.description,
              c.start_at,
              c.end_at,
              c.theme_json,
              c.banner_url,
              COALESCE(GROUP_CONCAT(cm.mission_id), '') AS mission_ids
         FROM campaigns c
    LEFT JOIN campaign_missions cm ON cm.campaign_id = c.id
        WHERE c.id = ?1
     GROUP BY c.id`,
    )
    .bind(id)
    .first<CampaignRow & { mission_ids: string }>();
  return row ? rowToCampaign(row) : null;
}

export async function listCampaigns(db: D1Database): Promise<Campaign[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id,
              c.title,
              c.description,
              c.start_at,
              c.end_at,
              c.theme_json,
              c.banner_url,
              COALESCE(GROUP_CONCAT(cm.mission_id), '') AS mission_ids
         FROM campaigns c
    LEFT JOIN campaign_missions cm ON cm.campaign_id = c.id
     GROUP BY c.id
     ORDER BY c.start_at ASC, c.id ASC`,
    )
    .all<CampaignRow & { mission_ids: string }>();
  return results.map(rowToCampaign);
}

// -----------------------------------------------------------------------------
// Mission progress
// -----------------------------------------------------------------------------

export async function listProgressForUser(
  db: D1Database,
  userId: string,
  status?: MissionProgress["status"],
): Promise<MissionProgress[]> {
  const sql = status
    ? `SELECT user_id, mission_id, status, progress, current_count, target_count, updated_at
         FROM mission_progress
        WHERE user_id = ?1 AND status = ?2
        ORDER BY updated_at DESC`
    : `SELECT user_id, mission_id, status, progress, current_count, target_count, updated_at
         FROM mission_progress
        WHERE user_id = ?1
        ORDER BY updated_at DESC`;
  const stmt = status
    ? db.prepare(sql).bind(userId, status)
    : db.prepare(sql).bind(userId);
  const { results } = await stmt.all<MissionProgressRow>();
  return results.map(rowToMissionProgress);
}

export async function getProgress(
  db: D1Database,
  userId: string,
  missionId: string,
): Promise<MissionProgress | null> {
  const row = await db
    .prepare(
      `SELECT user_id, mission_id, status, progress, current_count, target_count, updated_at
         FROM mission_progress
        WHERE user_id = ?1 AND mission_id = ?2`,
    )
    .bind(userId, missionId)
    .first<MissionProgressRow>();
  return row ? rowToMissionProgress(row) : null;
}

/**
 * Upsert mission progress. The `(user_id, mission_id)` composite PK drives
 * the ON CONFLICT clause. Callers compute the new counts/status — this layer
 * just persists.
 */
export async function upsertProgress(
  db: D1Database,
  p: MissionProgress,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mission_progress
         (user_id, mission_id, status, progress, current_count, target_count, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(user_id, mission_id) DO UPDATE SET
         status        = excluded.status,
         progress      = excluded.progress,
         current_count = excluded.current_count,
         target_count  = excluded.target_count,
         updated_at    = excluded.updated_at`,
    )
    .bind(
      p.userId,
      p.missionId,
      p.status,
      p.progress,
      p.currentCount,
      p.targetCount,
      p.updatedAt,
    )
    .run();
}

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

/**
 * Append an event to the journal. The route layer is expected to:
 *   1) ensure the `users` row exists (INSERT OR IGNORE),
 *   2) generate `e.id` (UUID),
 *   3) handle the idempotency-key dedupe at the KV layer FIRST so the
 *      partial-unique index here is only a defence-in-depth guard.
 */
export async function insertEvent(
  db: D1Database,
  e: Event & { id: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO events (id, user_id, name, payload_json, timestamp, idempotency_key)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    )
    .bind(
      e.id,
      e.userId,
      e.name,
      JSON.stringify(e.payload),
      e.timestamp,
      e.idempotencyKey ?? null,
    )
    .run();
}

export async function recentEventsForUser(
  db: D1Database,
  userId: string,
  limit: number,
): Promise<Event[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, payload_json, timestamp, idempotency_key
         FROM events
        WHERE user_id = ?1
        ORDER BY timestamp DESC
        LIMIT ?2`,
    )
    .bind(userId, safeLimit)
    .all<EventRow>();
  return results.map(rowToEvent);
}

/**
 * Look up an event by `(user_id, idempotency_key)` — the same pair that the
 * partial unique index `idx_events_user_idem` enforces. Returns the event row
 * plus its internal `id` (the route layer needs the id to rebuild the prior
 * response on the D1-replay fallback path).
 *
 * Added by TASK-008 (events-route-builder, teammate B) — see brief
 * "Coordination notes". Teammate A's rule engine does not call this, so the
 * addition is safe to ship in parallel.
 */
export async function getEventByIdemKey(
  db: D1Database,
  userId: string,
  idempotencyKey: string,
): Promise<(Event & { id: string }) | null> {
  const row = await db
    .prepare(
      `SELECT id, user_id, name, payload_json, timestamp, idempotency_key
         FROM events
        WHERE user_id = ?1 AND idempotency_key = ?2`,
    )
    .bind(userId, idempotencyKey)
    .first<EventRow>();
  if (row === null) return null;
  return { ...rowToEvent(row), id: row.id };
}

// -----------------------------------------------------------------------------
// Balances
// -----------------------------------------------------------------------------

export async function getBalance(
  db: D1Database,
  userId: string,
  currency: string,
): Promise<Balance | null> {
  const row = await db
    .prepare(
      `SELECT user_id, currency, amount, updated_at
         FROM balances
        WHERE user_id = ?1 AND currency = ?2`,
    )
    .bind(userId, currency)
    .first<BalanceRow>();
  return row ? rowToBalance(row) : null;
}

export async function listBalances(
  db: D1Database,
  userId: string,
): Promise<Balance[]> {
  const { results } = await db
    .prepare(
      `SELECT user_id, currency, amount, updated_at
         FROM balances
        WHERE user_id = ?1
        ORDER BY currency ASC`,
    )
    .bind(userId)
    .all<BalanceRow>();
  return results.map(rowToBalance);
}

/**
 * Atomically adjust a user's balance by `delta` (positive or negative) for
 * the given currency, then return the resulting row.
 *
 * Atomicity model: D1 executes a batched statement set against a single
 * SQLite connection, so this single-statement `INSERT ... ON CONFLICT DO
 * UPDATE` is naturally atomic at the row level. We do NOT use `db.batch`
 * here because a single UPSERT covers both the create and the update path.
 * The followup SELECT reads back the persisted row in the same connection.
 *
 * Caller is responsible for any business-level invariants (e.g. preventing
 * balance from going negative) — this helper is mechanical.
 */
export async function adjustBalance(
  db: D1Database,
  userId: string,
  currency: string,
  delta: number,
): Promise<Balance> {
  const updatedAt = Date.now();
  await db
    .prepare(
      `INSERT INTO balances (user_id, currency, amount, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(user_id, currency) DO UPDATE SET
         amount     = balances.amount + excluded.amount,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, currency, delta, updatedAt)
    .run();
  const balance = await getBalance(db, userId, currency);
  if (balance === null) {
    // Should be unreachable — we just upserted the row. Belt-and-braces
    // because the type signature promises a non-null Balance.
    throw new Error(
      `adjustBalance: balance row vanished after upsert for ${userId}/${currency}`,
    );
  }
  return balance;
}

// -----------------------------------------------------------------------------
// Atomic claim (TASK-010)
// -----------------------------------------------------------------------------

/**
 * Possible outcomes from `claimMission`. The route layer maps these to HTTP
 * status codes:
 *   - `not_found`         → 404 (mission doesn't exist OR user has no progress)
 *   - `not_completed`     → 409 (progress exists but status !== "completed")
 *   - `claimed_now`       → 200 (this call performed the transition + mint)
 *   - `claimed_idempotent`→ 200 (already claimed; returns the existing state)
 */
export type ClaimOutcome =
  | { kind: "not_found" }
  | { kind: "not_completed" }
  | {
      kind: "claimed_now" | "claimed_idempotent";
      progress: MissionProgress;
      balance: Balance | null;
      reward: Reward;
    };

/**
 * Atomically transition mission_progress from "completed" → "claimed" AND mint
 * the reward (if currency-kind) into balances. Combines both writes into a
 * single `db.batch([...])` round-trip.
 *
 * Detection / idempotency:
 *   1. SELECT current progress + mission (one statement, joins missions for the
 *      reward JSON).
 *   2. If no row at all → return `not_found`. The mission either doesn't exist
 *      OR the user has no progress on it (both are 404 from the route layer's
 *      perspective; differentiation requires a second SELECT and isn't worth
 *      the round-trip for v0.1).
 *   3. If `status === "claimed"` → idempotent replay. Read current balance for
 *      the reward's currency (if any), return it. No writes.
 *   4. If `status !== "completed"` (e.g. "active" or "locked") → return
 *      `not_completed`. Route maps to 409.
 *   5. Otherwise (`status === "completed"`): build the batch. The UPDATE
 *      includes a CAS guard `WHERE status='completed'` so a concurrent claimer
 *      can only succeed once. If the UPDATE matched 0 rows, we re-read and
 *      return the idempotent-replay path (the other caller won the race).
 *
 * Atomicity: `db.batch([...])` runs the statements in a single SQLite
 * transaction. Either both the UPDATE and the balance INSERT/UPDATE land, or
 * neither does.
 *
 * Returns `null` is intentionally avoided — every outcome is discriminated on
 * `.kind` so callers can switch exhaustively. Mission-not-found and
 * progress-not-found collapse to a single `not_found` because the route's
 * 404-vs-409 decision doesn't differentiate them.
 */
export async function claimMission(
  db: D1Database,
  userId: string,
  missionId: string,
  nowMs: number,
): Promise<ClaimOutcome> {
  // Bound the retry loop. The only path that loops is the CAS-lost-race path
  // where the UPDATE matched 0 rows — on the second iteration `status` is
  // either "claimed" (idempotent replay) or "not_completed" (loss → race
  // result a non-trivial concurrent transition we treat as 409).
  for (let attempt = 0; attempt < 2; attempt++) {
    // Step 1 — single SELECT joining missions for the reward shape.
    const row = await db
      .prepare(
        `SELECT mp.status        AS status,
                mp.progress       AS progress,
                mp.current_count  AS current_count,
                mp.target_count   AS target_count,
                mp.updated_at     AS updated_at,
                m.reward_json     AS reward_json
           FROM mission_progress mp
           JOIN missions m ON m.id = mp.mission_id
          WHERE mp.user_id = ?1 AND mp.mission_id = ?2`,
      )
      .bind(userId, missionId)
      .first<{
        status: MissionProgress["status"];
        progress: number;
        current_count: number;
        target_count: number;
        updated_at: number;
        reward_json: string;
      }>();

    if (row === null) {
      return { kind: "not_found" };
    }
    const reward = parseJson<Reward>(row.reward_json);
    const progressRow: MissionProgress = {
      userId,
      missionId,
      status: row.status,
      progress: row.progress,
      currentCount: row.current_count,
      targetCount: row.target_count,
      updatedAt: row.updated_at,
    };

    // Step 2 — idempotent replay: already claimed.
    if (row.status === "claimed") {
      const balance =
        reward.kind === "currency"
          ? await getBalance(db, userId, reward.currency)
          : null;
      return {
        kind: "claimed_idempotent",
        progress: progressRow,
        balance,
        reward,
      };
    }

    // Step 3 — not yet completed → 409 path.
    if (row.status !== "completed") {
      return { kind: "not_completed" };
    }

    // Step 4 — build & run the atomic batch.
    const stmts: D1PreparedStatement[] = [];

    // UPDATE with CAS guard. If a concurrent claimer already transitioned the
    // row to "claimed", this UPDATE matches 0 rows and we retry the loop.
    stmts.push(
      db
        .prepare(
          `UPDATE mission_progress
              SET status = 'claimed',
                  updated_at = ?3
            WHERE user_id = ?1 AND mission_id = ?2 AND status = 'completed'`,
        )
        .bind(userId, missionId, nowMs),
    );

    // For currency rewards, mint into balances in the same batch. The UPSERT
    // pattern matches `adjustBalance` but is inlined so it's part of the
    // atomic transaction (D1 doesn't support nested helpers in batch).
    if (reward.kind === "currency") {
      stmts.push(
        db
          .prepare(
            `INSERT INTO balances (user_id, currency, amount, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(user_id, currency) DO UPDATE SET
               amount     = balances.amount + excluded.amount,
               updated_at = excluded.updated_at`,
          )
          .bind(userId, reward.currency, reward.amount, nowMs),
      );
    }

    const batchResults = await db.batch(stmts);
    const updateResult = batchResults[0];
    const rowsChanged = updateResult?.meta.rows_written ?? 0;

    if (rowsChanged === 0) {
      // CAS lost — another caller flipped the status between our SELECT and
      // our UPDATE. Loop once more: the second SELECT should see "claimed"
      // and return the idempotent-replay path. Two iterations max.
      continue;
    }

    // Read back the final state.
    const finalProgress = await getProgress(db, userId, missionId);
    if (finalProgress === null) {
      // Should be unreachable — we just upserted the row.
      throw new Error(
        `claimMission: progress row vanished after claim for ${userId}/${missionId}`,
      );
    }
    const balance =
      reward.kind === "currency"
        ? await getBalance(db, userId, reward.currency)
        : null;
    return {
      kind: "claimed_now",
      progress: finalProgress,
      balance,
      reward,
    };
  }

  // Fall-through after 2 iterations — the race resolved into "not_completed"
  // (very unusual; e.g. an admin manually reset status mid-race). Treat as 409.
  return { kind: "not_completed" };
}
