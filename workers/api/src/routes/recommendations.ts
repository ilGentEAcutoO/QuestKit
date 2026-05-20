/**
 * /v1/recommendations — AI-powered mission recommendations (TASK-017).
 *
 * Route: GET /v1/recommendations
 * Auth:  JWT Bearer (requireAuth from TASK-007)
 *
 * Pipeline:
 *   1. requireAuth populates c.var.userId.
 *   2. Load up to 50 most-recent events for the user from D1.
 *   3. Load the user's "active" missions — those with progress rows in
 *      status IN ('active', 'completed'). A brand-new user with no progress
 *      yields an empty list → we short-circuit and return an empty result
 *      WITHOUT calling the AI (saves an inference; matches the brief).
 *   4. Delegate to `services/ai.ts#recommendMissions` which handles caching,
 *      prompt construction, model invocation, response validation,
 *      hallucinated-ID filtering, AND graceful fallback on malformed AI
 *      responses (Phase 8 / v0.1.4 TASK-002). The service returns
 *      `{ fallback: true, ... }` instead of throwing — surfaced verbatim
 *      below with HTTP 200.
 *   5. Catch any `env.AI` binding outage (timeout, missing model, network)
 *      and translate to the same fallback payload — the UI should NEVER see
 *      a red 502/503 from this route. Status code remains 200.
 *
 * Response shape (locked):
 *   { missionIds: string[], reason: string, cached: boolean, count: number,
 *     fallback?: boolean }
 *
 *   `count` is the length of `missionIds` after hallucination filtering —
 *   gives the UI a single field to test for `count === 0` without scanning
 *   the array.
 *
 *   `fallback` is present and `true` ONLY when the AI is unavailable; the
 *   UI uses it to render a tasteful empty-state instead of a real
 *   recommendations panel. Successful responses omit the field entirely
 *   so existing UI code that ignores `fallback` continues to work.
 *
 * ## Why "active" missions = active ∪ completed?
 *
 * "Active" in product terms means "in flight or ready to claim". A completed
 * mission still belongs in the recommendations pool until the user actually
 * claims (status="claimed"); the AI should surface it as a "claim this now"
 * nudge if the user's recent activity matches.
 */
import type { Mission } from "@questkit/types";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";
import {
  getMission,
  listProgressForUser,
  recentEventsForUser,
} from "../db/schema";
import { FALLBACK_REASON, recommendMissions } from "../services/ai";

interface RecommendationsVars {
  userId: string;
  jti: string;
}

const recommendations = new Hono<{
  Bindings: Env;
  Variables: RecommendationsVars;
}>();

recommendations.use("/*", requireAuth());

interface RecommendationsResponse {
  missionIds: string[];
  reason: string;
  cached: boolean;
  count: number;
  /**
   * Present and `true` only when the AI was unavailable. Omitted on success.
   * The UI checks for this to render a graceful empty-state.
   */
  fallback?: boolean;
}

/**
 * Load active+completed missions for a user — join through mission_progress.
 *
 * We pull the full progress map, filter to active/completed, then resolve
 * the missions one at a time via getMission. For v0.1 the count is bounded
 * by total missions (6 seeded) so the round-trip cost is tiny; if we ever
 * grow to thousands of missions per campaign, this becomes a single JOIN
 * query instead.
 */
async function loadActiveMissionsForUser(
  db: D1Database,
  userId: string,
): Promise<Mission[]> {
  const progressList = await listProgressForUser(db, userId);
  const activeIds: string[] = [];
  for (const p of progressList) {
    if (p.status === "active" || p.status === "completed") {
      activeIds.push(p.missionId);
    }
  }
  if (activeIds.length === 0) return [];
  const missions: Mission[] = [];
  for (const id of activeIds) {
    const m = await getMission(db, id);
    if (m !== null) missions.push(m);
  }
  return missions;
}

recommendations.get("/", async (c) => {
  const userId = c.var.userId;

  // Load context for the recommender. Both queries are user-scoped via D1
  // prepared statements (db/schema.ts is the boundary).
  const [events, missions] = await Promise.all([
    recentEventsForUser(c.env.DB, userId, 50),
    loadActiveMissionsForUser(c.env.DB, userId),
  ]);

  // Short-circuit on empty active missions — saves an inference and matches
  // the brief's "Empty activeMissions → returns { missionIds: [], reason:
  // '...' } without calling AI" test.
  if (missions.length === 0) {
    const response: RecommendationsResponse = {
      missionIds: [],
      reason: "Start firing events to unlock personalised missions.",
      cached: false,
      count: 0,
    };
    return c.json(response, 200);
  }

  // Delegate to the service. The service handles malformed AI responses
  // internally (returns `{ fallback: true, missionIds: [], ... }` instead
  // of throwing). We only need to catch a binding outage (env.AI throws),
  // and in that case we ALSO return a 200 fallback so the UI never sees
  // a red error from this route.
  try {
    const result = await recommendMissions(c.env, userId, events, missions);
    const response: RecommendationsResponse = {
      missionIds: result.missionIds,
      reason: result.reason,
      cached: result.cached,
      count: result.missionIds.length,
      ...(result.fallback === true ? { fallback: true } : {}),
    };
    return c.json(response, 200);
  } catch (err) {
    console.warn("[recommendations] ai binding failure, falling back", err);
    const response: RecommendationsResponse = {
      missionIds: [],
      reason: FALLBACK_REASON,
      cached: false,
      count: 0,
      fallback: true,
    };
    return c.json(response, 200);
  }
});

export default recommendations;
