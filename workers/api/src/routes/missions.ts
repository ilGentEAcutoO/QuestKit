/**
 * /v1/missions — list / detail / claim routes (TASK-010).
 *
 * All routes require auth (JWT Bearer via `requireAuth`).
 *
 * ## Routes
 *
 *   GET  /v1/missions?campaignId&status&limit&cursor
 *     Lists missions (paginated by opaque cursor). When `status` is supplied
 *     the result is filtered to missions where the caller has a progress row
 *     of that status — i.e. it joins user progress into the listing. Returns
 *     `{ missions, progress, nextCursor? }`. `progress` is a map keyed by
 *     mission id; entries only exist for missions that have a progress row.
 *
 *   GET  /v1/missions/:id
 *     Returns one mission + the caller's progress (null if no row).
 *
 *   POST /v1/missions/:id/claim
 *     Atomic transition completed → claimed + reward mint. Idempotent on the
 *     Idempotency-Key header (replay returns the same response with
 *     `X-Idempotent-Replay: hit`). Without the header, the helper still
 *     handles "already claimed" via SELECT-then-CAS-batch — see
 *     `db/schema.ts#claimMission`. Broadcasts an SDKUpdate over SSE_HUB
 *     (best-effort: a broken hub is logged but does not fail the claim).
 *
 * ## SSE broadcast variants (Phase 9 / TASK-001)
 *
 * On a fresh claim we broadcast THREE events in this order (each best-effort):
 *
 *   1. `mission.claimed`   — terminal status flip (UI flips card to "Claimed"
 *                            FIRST so subsequent toasts land on a disabled
 *                            button; ordering matters for UX).
 *   2. `reward.granted`    — toast trigger (userId + reward + missionId).
 *   3. `balance.changed`   — currency rewards only; refreshes BalanceBadge etc.
 *
 * Before TASK-001 we omitted (1) and relied on `reward.granted` to do double
 * duty as "claim happened". The hook didn't subscribe to that variant, so the
 * card stayed at "Claim" forever — exactly bug B1. With (1) in place,
 * `useMissions`'s subscriber flips `progress[missionId].status` to "claimed"
 * and the card re-renders with the disabled "Claimed" button.
 *
 * ## Rate-limiter note
 *
 * Read routes (GET) do not call the rate-limiter — events.ts is the only
 * route that needs the per-JWT limit today. POST /:id/claim could plausibly
 * need it as well; that wire-up is left as a follow-up (low priority — the
 * claim path is gated by a strict completed→claimed CAS, so abuse is bounded
 * by the rule engine).
 */
import type {
  Balance,
  Mission,
  MissionProgress,
  Reward,
  SDKUpdate,
} from "@questkit/types";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";
import {
  claimMission as claimMissionDb,
  getMission,
  getProgress,
  listMissions,
  listProgressForUser,
} from "../db/schema";
import * as idem from "../services/idempotency";

interface MissionsVars {
  userId: string;
  jti: string;
}

const missions = new Hono<{ Bindings: Env; Variables: MissionsVars }>();

missions.use("/*", requireAuth());

interface MissionsListResponse {
  missions: Mission[];
  progress: Record<string, MissionProgress>;
  nextCursor?: string;
}

interface MissionDetailResponse {
  mission: Mission;
  progress: MissionProgress | null;
}

interface ClaimResponse {
  progress: MissionProgress;
  balance: Balance | null;
  reward: Reward;
}

/**
 * Parse + validate the `status` query param. Returns one of the valid status
 * filter values or null for "no filter". Unknown values fall back to null
 * (lenient — clients may forward stale enums and we'd rather render the full
 * list than 400).
 */
function parseStatusFilter(
  raw: string | undefined,
): MissionProgress["status"] | "all" | null {
  if (raw === undefined || raw === "" || raw === "all") return "all";
  if (
    raw === "locked" ||
    raw === "active" ||
    raw === "completed" ||
    raw === "claimed"
  ) {
    return raw;
  }
  return "all";
}

missions.get("/", async (c) => {
  const userId = c.var.userId;
  const url = new URL(c.req.url);
  const campaignId = url.searchParams.get("campaignId") ?? undefined;
  const statusParam = url.searchParams.get("status") ?? undefined;
  const limitParam = url.searchParams.get("limit");
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const limit =
    limitParam !== null && limitParam !== ""
      ? Number.parseInt(limitParam, 10)
      : undefined;

  const statusFilter = parseStatusFilter(statusParam);

  // Load the page (with the campaign filter if specified). `listMissions`
  // already handles `limit + cursor` with the opaque base64url cursor.
  const listOpts: {
    campaignId?: string;
    limit?: number;
    cursor?: string;
  } = {};
  if (campaignId !== undefined) listOpts.campaignId = campaignId;
  if (limit !== undefined && Number.isFinite(limit)) listOpts.limit = limit;
  if (cursor !== undefined) listOpts.cursor = cursor;
  const { missions: pageMissions, nextCursor } = await listMissions(
    c.env.DB,
    listOpts,
  );

  // Load the user's progress map. We pull the FULL progress set so the
  // response can include progress for every mission on the page (callers
  // commonly want to render progress alongside the mission). For a status
  // filter we further winnow at status level here rather than in the DB layer
  // because the page filter & status filter intersect in JS — we want to
  // preserve cursor stability against listMissions's id-ordering.
  const allProgress = await listProgressForUser(c.env.DB, userId);
  const progressByMissionId = new Map<string, MissionProgress>();
  for (const p of allProgress) {
    progressByMissionId.set(p.missionId, p);
  }

  // Apply the status filter (if any) by selecting only missions whose progress
  // status matches. "all" passes everything through.
  const filteredMissions =
    statusFilter !== null && statusFilter !== "all"
      ? pageMissions.filter(
          (m) => progressByMissionId.get(m.id)?.status === statusFilter,
        )
      : pageMissions;

  // Build the progress map keyed by mission id, restricted to missions that
  // remain in the response.
  const progressMap: Record<string, MissionProgress> = {};
  for (const m of filteredMissions) {
    const p = progressByMissionId.get(m.id);
    if (p !== undefined) progressMap[m.id] = p;
  }

  const response: MissionsListResponse = {
    missions: filteredMissions,
    progress: progressMap,
  };
  if (nextCursor !== undefined) response.nextCursor = nextCursor;
  return c.json(response, 200);
});

missions.get("/:id", async (c) => {
  const userId = c.var.userId;
  const id = c.req.param("id");
  const mission = await getMission(c.env.DB, id);
  if (mission === null) {
    return c.json({ error: "mission_not_found" }, 404);
  }
  const progress = await getProgress(c.env.DB, userId, id);
  const response: MissionDetailResponse = { mission, progress };
  return c.json(response, 200);
});

/**
 * Per-call ceiling for any SSE_HUB DO RPC. The DO's own broadcast caps each
 * writer at 1s, and the parallel `Promise.allSettled` waits for all writers,
 * so 2s is a comfortable upper bound on a healthy DO. If the DO itself is
 * wedged (workerd quirk, OOM, etc.) this `AbortSignal.timeout` ensures the
 * worker request thread never deadlocks waiting on the RPC — the broadcast
 * is best-effort by contract, so timing it out is safe.
 */
const SSE_HUB_TIMEOUT_MS = 2000;

/**
 * Attempt an SSE broadcast for the claim. Best-effort: any failure is logged
 * but does NOT propagate — the claim already succeeded. TASK-012's SDK fills
 * the gap on reconnect (the SDK polls /v1/missions and /v1/balance on a
 * reconnect to reconcile state).
 *
 * Phase 9 / TASK-001 (Cluster C1) broadcasts THREE events in order:
 *   1. `mission.claimed`  — carries post-claim `MissionProgress` (status =
 *      "claimed"). Emitted FIRST so `useMissions` flips the card state to
 *      "Claimed" before any toast lands.
 *   2. `reward.granted`   — userId + reward + missionId for the toast.
 *   3. `balance.changed`  — only when reward is currency-kind (balance != null).
 *
 * Order matters: the UI wants the card disabled BEFORE the celebratory toast
 * appears, otherwise a flicker is possible.
 *
 * Deadlock hardening (Phase 8 / v0.1.4 TASK-001):
 *   All stub.fetch calls arm `AbortSignal.timeout(2000)` so a wedged DO
 *   never holds the broadcast. The CALLER (the claim route) detaches the
 *   whole tryBroadcastClaim call via `c.executionCtx.waitUntil(...)` so
 *   even broadcast latency in the healthy-but-slow case doesn't gate the
 *   client response. If the DO is wedged so badly that all three broadcasts
 *   silently drop, the demo's `useMissionClaim` refetches `/v1/missions`
 *   after the API returns 200, providing a belt-and-suspenders fallback.
 */
async function tryBroadcastClaim(
  env: Env,
  userId: string,
  missionId: string,
  progress: MissionProgress,
  reward: Reward,
  balance: Balance | null,
): Promise<void> {
  try {
    const stubId = env.SSE_HUB.idFromName(userId);
    const stub = env.SSE_HUB.get(stubId);

    // 1. mission.claimed — terminal status flip. MUST go first so the UI
    //    flips the card to a disabled "Claimed" state before any reward
    //    toast lands on it. The payload is the authoritative post-claim
    //    MissionProgress straight from D1, so consumers can overwrite
    //    unconditionally.
    const claimedUpdate: SDKUpdate = {
      type: "mission.claimed",
      data: progress,
    };
    const r0 = await stub.fetch("https://_/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(claimedUpdate),
      signal: AbortSignal.timeout(SSE_HUB_TIMEOUT_MS),
    });
    if (r0.status !== 200) {
      console.warn(`[claim] sse-hub returned unexpected status ${r0.status}`);
    }

    // 2. reward.granted — drives the toast.
    const rewardUpdate: SDKUpdate = {
      type: "reward.granted",
      data: { userId, reward, missionId },
    };
    const r1 = await stub.fetch("https://_/broadcast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(rewardUpdate),
      signal: AbortSignal.timeout(SSE_HUB_TIMEOUT_MS),
    });
    if (r1.status !== 200) {
      console.warn(`[claim] sse-hub returned unexpected status ${r1.status}`);
    }

    // 3. balance.changed — currency rewards only.
    if (balance !== null) {
      const balanceUpdate: SDKUpdate = {
        type: "balance.changed",
        data: balance,
      };
      const r2 = await stub.fetch("https://_/broadcast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(balanceUpdate),
        signal: AbortSignal.timeout(SSE_HUB_TIMEOUT_MS),
      });
      if (r2.status !== 200) {
        console.warn(`[claim] sse-hub returned unexpected status ${r2.status}`);
      }
    }
  } catch (err) {
    // Network-level failures (incl. AbortError from the timeout): we never
    // let the broadcast take down the claim. The DB UPSERT in
    // `claimMissionDb` has already committed at this point.
    console.warn("[claim] sse-hub broadcast threw, swallowed", err);
  }
}

missions.post("/:id/claim", async (c) => {
  const userId = c.var.userId;
  const missionId = c.req.param("id");

  // Step 1 — idempotency cache check (header only; claim has no body).
  const headerKey = c.req.header("idempotency-key");
  const idemKey =
    typeof headerKey === "string" && headerKey.length > 0
      ? headerKey
      : undefined;
  if (idemKey !== undefined) {
    const cached = await idem.getCached<ClaimResponse>(
      c.env.CACHE,
      userId,
      `claim:${idemKey}`,
    );
    if (cached !== null) {
      return c.json(cached, 200, { "x-idempotent-replay": "hit" });
    }
  }

  // Step 2 — atomic claim. The helper differentiates not_found / not_completed
  // / claimed_now / claimed_idempotent.
  const outcome = await claimMissionDb(c.env.DB, userId, missionId, Date.now());

  if (outcome.kind === "not_found") {
    // Differentiate "mission doesn't exist" from "user has no progress". One
    // extra SELECT here is cheap and the precision pays off in the client UI.
    const mission = await getMission(c.env.DB, missionId);
    if (mission === null) {
      return c.json({ error: "mission_not_found" }, 404);
    }
    // Mission exists but no progress row → treat as "not ready to claim".
    return c.json({ error: "claim_not_ready" }, 409);
  }
  if (outcome.kind === "not_completed") {
    return c.json({ error: "claim_not_ready" }, 409);
  }

  // claimed_now or claimed_idempotent — same response shape.
  const response: ClaimResponse = {
    progress: outcome.progress,
    balance: outcome.balance,
    reward: outcome.reward,
  };

  // Step 3 — broadcast on a fresh claim only. Idempotent replays should NOT
  // re-broadcast (the original broadcast already fired).
  //
  // Detached via `c.executionCtx.waitUntil` (Phase 8 / v0.1.4 TASK-001):
  // the broadcast is best-effort — the D1 transaction in `claimMissionDb`
  // has already committed by this point. Holding the response on the SSE
  // RPC was the root cause of the "claim hangs forever" bug; with
  // `waitUntil` the broadcast finishes after the response is sent, and the
  // request returns as soon as the KV cache write below settles.
  if (outcome.kind === "claimed_now") {
    c.executionCtx.waitUntil(
      tryBroadcastClaim(
        c.env,
        userId,
        missionId,
        outcome.progress,
        outcome.reward,
        outcome.balance,
      ),
    );
  }

  // Step 4 — cache the response for idempotent replay.
  if (idemKey !== undefined) {
    await idem.putCached(c.env.CACHE, userId, `claim:${idemKey}`, response);
  }

  return c.json(response, 200);
});

export default missions;
