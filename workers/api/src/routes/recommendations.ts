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
 *      prompt construction, model invocation, response validation, and
 *      hallucinated-ID filtering.
 *   5. Map errors:
 *      - AiResponseError      → 502 ai_response_malformed
 *      - other env.AI failures → 503 ai_unavailable
 *
 * Response shape (locked):
 *   { missionIds: string[], reason: string, cached: boolean, count: number }
 *
 *   `count` is the length of `missionIds` after hallucination filtering —
 *   gives the UI a single field to test for `count === 0` without scanning
 *   the array.
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
import { AiResponseError, recommendMissions } from "../services/ai";

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

  // Delegate to the service. AiResponseError → 502; anything else from
  // env.AI (binding outage, timeout, etc.) → 503.
  try {
    const result = await recommendMissions(c.env, userId, events, missions);
    const response: RecommendationsResponse = {
      missionIds: result.missionIds,
      reason: result.reason,
      cached: result.cached,
      count: result.missionIds.length,
    };
    return c.json(response, 200);
  } catch (err) {
    if (err instanceof AiResponseError) {
      console.warn("[recommendations] ai response malformed", err);
      return c.json({ error: "ai_response_malformed" }, 502);
    }
    console.warn("[recommendations] ai binding failure", err);
    return c.json({ error: "ai_unavailable" }, 503);
  }
});

export default recommendations;
