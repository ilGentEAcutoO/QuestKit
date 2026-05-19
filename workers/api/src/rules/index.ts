/**
 * Rule engine entry-point — public surface used by `/v1/events` (TASK-008).
 *
 * The orchestrator is the ONLY piece of the rule engine that touches D1.
 * `evaluate`, `matchesFilter`, and `windowBounds` are deterministic pure
 * functions; this file glues them to the persistence layer.
 *
 * Locked contract (from TASK-009 brief — Teammate B is coding against this):
 *
 *   ```ts
 *   export async function evaluateEvent(
 *     db: D1Database,
 *     event: Event,
 *     candidateMissions: Mission[],
 *   ): Promise<MissionProgress[]>;
 *   ```
 *
 * Caller responsibilities:
 *   - `candidateMissions` is the already-filtered active set (B has done the
 *     `expiresAt` + campaign-window filtering upstream). We don't re-filter.
 *   - The user row (`event.userId`) must already exist (B's route calls
 *     `ensureUser` before invoking us).
 *
 * Our responsibilities:
 *   - Load the user's current progress for the candidate set in one round-trip.
 *   - Run `evaluate` per mission.
 *   - Batch the resulting upserts via `db.batch(...)` for one D1 round-trip.
 *   - Return the rows whose progress changed (caller broadcasts these on SSE).
 */
import type { Event, Mission, MissionProgress } from "@questkit/types";
import { evaluate } from "./evaluator";

/**
 * Public entry-point. See file-level doc for the contract.
 */
export async function evaluateEvent(
  db: D1Database,
  event: Event,
  candidateMissions: Mission[],
): Promise<MissionProgress[]> {
  if (candidateMissions.length === 0) return [];

  // Use a single `now` across all per-mission evaluations so the window
  // arithmetic and the persisted `updatedAt` are consistent.
  const now = Date.now();

  // 1) Load the user's current progress for every candidate mission in ONE
  //    query. We use an explicit `IN (?,?,...)` over the candidate IDs rather
  //    than calling `listProgressForUser` because the candidate set may be
  //    much smaller than the user's full progress history.
  //
  //    Why not add a `getProgressForMissions` helper to db/schema.ts?
  //    Per the TASK-009 coordination note, we share that file with Teammate
  //    B's TASK-008 work. To minimise merge-conflict surface, this query
  //    lives here. If a second consumer arises, we can promote it later.
  const missionIds = candidateMissions.map((m) => m.id);
  const placeholders = missionIds.map((_, i) => `?${i + 2}`).join(",");
  const { results: progressRows } = await db
    .prepare(
      `SELECT user_id, mission_id, status, progress, current_count, target_count, updated_at
         FROM mission_progress
        WHERE user_id = ?1 AND mission_id IN (${placeholders})`,
    )
    .bind(event.userId, ...missionIds)
    .all<ProgressRow>();

  const progressByMissionId = new Map<string, MissionProgress>();
  for (const row of progressRows) {
    progressByMissionId.set(row.mission_id, rowToProgress(row));
  }

  // 2) Evaluate each candidate mission. Collect only the matches; build the
  //    batched upsert at the same time.
  const updates: MissionProgress[] = [];
  const batchStmts: D1PreparedStatement[] = [];
  const upsertStmt = db.prepare(
    `INSERT INTO mission_progress
       (user_id, mission_id, status, progress, current_count, target_count, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(user_id, mission_id) DO UPDATE SET
       status        = excluded.status,
       progress      = excluded.progress,
       current_count = excluded.current_count,
       target_count  = excluded.target_count,
       updated_at    = excluded.updated_at`,
  );

  for (const mission of candidateMissions) {
    const current = progressByMissionId.get(mission.id) ?? null;
    const result = evaluate(event, mission, current, now);
    if (!result.matched || result.updatedProgress === null) continue;
    const p = result.updatedProgress;
    updates.push(p);
    batchStmts.push(
      upsertStmt.bind(
        p.userId,
        p.missionId,
        p.status,
        p.progress,
        p.currentCount,
        p.targetCount,
        p.updatedAt,
      ),
    );
  }

  // 3) Batch all upserts in one D1 round-trip if there's anything to write.
  if (batchStmts.length > 0) {
    await db.batch(batchStmts);
  }

  return updates;
}

// -----------------------------------------------------------------------------
// internals
// -----------------------------------------------------------------------------

/**
 * Row shape from `mission_progress`. Mirrors the snake_case columns from
 * `0001_init.sql`. We keep it private (the public layer always returns
 * camelCase `MissionProgress`).
 */
interface ProgressRow {
  user_id: string;
  mission_id: string;
  status: MissionProgress["status"];
  progress: number;
  current_count: number;
  target_count: number;
  updated_at: number;
}

function rowToProgress(row: ProgressRow): MissionProgress {
  return {
    userId: row.user_id,
    missionId: row.mission_id,
    status: row.status,
    progress: row.progress,
    currentCount: row.current_count,
    targetCount: row.target_count,
    updatedAt: row.updated_at,
  };
}
