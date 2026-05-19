/**
 * Per-mission evaluation core. Pure, no I/O.
 *
 * Given an `Event`, a `Mission`, and the user's current `MissionProgress` on
 * that mission (null = first attempt), compute:
 *   - whether the event matches (`matched`),
 *   - the new running counter (`newCurrentCount`),
 *   - the resulting status (`locked` / `active` / `completed`),
 *   - the full updated `MissionProgress` row to persist.
 *
 * Status machine (from TASK-009 brief):
 *
 *   locked  ──first match──▶ active
 *   active  ──count ≥ target──▶ completed
 *   completed ──user claim (separate route, TASK-010)──▶ claimed
 *
 * Claimed is **terminal** within a window. If the window then advances (the
 * existing progress's `updatedAt` is in a prior window), the next match is
 * treated as a fresh attempt: counter resets to 0, status goes back through
 * the active/completed cycle. Lifetime missions never advance windows, so
 * claimed lifetime missions stay claimed forever.
 *
 * Counter reset rule: when the user's existing progress's `updatedAt` falls
 * OUTSIDE the window of `nowMs`, the counter starts over at 0. This is what
 * makes the daily/weekly windows feel like "resets at midnight" — we don't
 * carry yesterday's count into today's quota.
 *
 * Event-in-window rule: events whose `timestamp` falls in a window prior to
 * the current one are silently dropped. We don't backfill prior windows
 * (the operational complexity isn't justified for v0.1; late events can be
 * re-fired by the host if needed).
 */
import type { Event, Mission, MissionProgress } from "@questkit/types";
import { matchesFilter } from "./filter";
import { windowBounds } from "./window";

/**
 * Pure result returned to the orchestrator.
 *
 * `matched: false` → `updatedProgress` is null and the orchestrator MUST NOT
 * write anything to D1 for this mission.
 *
 * `matched: true` → `updatedProgress` is the full row to upsert; the
 * orchestrator does NOT need to recompute progress/clamp/status.
 */
export interface EvaluationResult {
  matched: boolean;
  newCurrentCount: number;
  status: MissionProgress["status"];
  updatedProgress: MissionProgress | null;
}

const NO_MATCH: EvaluationResult = {
  matched: false,
  newCurrentCount: 0,
  status: "locked",
  updatedProgress: null,
};

/**
 * Evaluate a single `(event, mission, currentProgress)` triple at time
 * `nowMs`. See the file-level doc for the full semantics; this fn is the
 * canonical implementation.
 */
export function evaluate(
  event: Event,
  mission: Mission,
  currentProgress: MissionProgress | null,
  nowMs: number,
): EvaluationResult {
  const { criteria } = mission;

  // 1) Event name must match.
  if (event.name !== criteria.eventName) return NO_MATCH;

  // 2) Filter must match (logical AND across keys; undefined filter = no
  //    constraint).
  if (!matchesFilter(criteria.filter, event.payload)) return NO_MATCH;

  // 3) Expiry check. `expiresAt` is a Unix ms; events strictly after it are
  //    ignored. Equality matches: a mission expiring AT noon includes an
  //    event AT noon.
  if (mission.expiresAt !== undefined && event.timestamp > mission.expiresAt) {
    return NO_MATCH;
  }

  // 4) Window check: the event's timestamp must lie within the window
  //    containing `nowMs`. Missions without an explicit window default to
  //    lifetime so they always pass step 4.
  const windowKind = criteria.window ?? "lifetime";
  const currentWindow = windowBounds(windowKind, nowMs);
  if (
    event.timestamp < currentWindow.startMs ||
    event.timestamp >= currentWindow.endMs
  ) {
    return NO_MATCH;
  }

  // 5) Determine the starting counter.
  //    - No existing progress → start at 0.
  //    - Existing progress in a prior window → reset to 0 (treat as fresh
  //      attempt). This is the same logic that handles `claimed → fresh
  //      cycle` when the window advances.
  //    - Existing progress in the current window AND status === "claimed"
  //      → no match (already claimed for this window; mission is dormant
  //      until next window).
  //    - Else → carry the existing counter.
  let startingCount: number;
  if (currentProgress === null) {
    startingCount = 0;
  } else {
    const existingInCurrentWindow =
      currentProgress.updatedAt >= currentWindow.startMs &&
      currentProgress.updatedAt < currentWindow.endMs;
    if (!existingInCurrentWindow) {
      startingCount = 0;
    } else {
      if (currentProgress.status === "claimed") {
        // Already claimed within this window — mission is dormant until the
        // window advances.
        return NO_MATCH;
      }
      startingCount = currentProgress.currentCount;
    }
  }

  const newCurrentCount = startingCount + 1;
  const targetCount = criteria.count;
  // `progress` is the human-facing percentage, clamped to [0, 1]. We
  // deliberately allow `newCurrentCount` to overshoot the target (the row
  // remains accurate for analytics) but cap the visible progress at 1.
  const progress = clamp01(newCurrentCount / targetCount);
  const status: MissionProgress["status"] =
    newCurrentCount >= targetCount ? "completed" : "active";

  const updatedProgress: MissionProgress = {
    userId: event.userId,
    missionId: mission.id,
    status,
    progress,
    currentCount: newCurrentCount,
    targetCount,
    updatedAt: nowMs,
  };

  return {
    matched: true,
    newCurrentCount,
    status,
    updatedProgress,
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
