/**
 * /v1/campaigns — list / detail (TASK-010).
 *
 * All routes require auth (JWT Bearer via `requireAuth`).
 *
 * ## Routes
 *
 *   GET /v1/campaigns?include=expired
 *     Returns `{ campaigns: Campaign[] }`. By default, filters to campaigns
 *     whose `end_at >= Date.now()` (active or upcoming), ordered by `start_at`.
 *     `?include=expired` bypasses the active-window filter and returns
 *     everything — useful for admin tooling and historical playback.
 *
 *   GET /v1/campaigns/:id?include=missions
 *     Returns `{ campaign: Campaign }` (with `missionIds` populated from the
 *     junction table) or 404 if not found. With `?include=missions` the
 *     response also carries a hydrated `missions[]` array (one row per id).
 *
 * ## "Active" definition
 *
 * `end_at >= now` (inclusive on the right boundary). A campaign that ended
 * exactly at `now` to-the-millisecond is still returned — this is harmless
 * (the campaign's missions will have already expired or been claimed) and
 * avoids the "but it should still appear for 5 more seconds" UX bug.
 *
 * `start_at` is NOT filtered — upcoming campaigns (start_at > now) ARE
 * returned. The plan §amendments describe this as "active or upcoming"
 * behaviour so clients can pre-fetch banners for tomorrow's campaign.
 */
import type { Campaign, Mission } from "@questkit/types";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";
import { getCampaign, getMission, listCampaigns } from "../db/schema";

interface CampaignsVars {
  userId: string;
  jti: string;
}

const campaigns = new Hono<{ Bindings: Env; Variables: CampaignsVars }>();

campaigns.use("/*", requireAuth());

campaigns.get("/", async (c) => {
  const url = new URL(c.req.url);
  const includeExpired = url.searchParams.get("include") === "expired";
  const all = await listCampaigns(c.env.DB);
  const now = Date.now();
  const filtered = includeExpired
    ? all
    : all.filter((camp) => camp.endAt >= now);
  return c.json(
    { campaigns: filtered } satisfies { campaigns: Campaign[] },
    200,
  );
});

campaigns.get("/:id", async (c) => {
  const id = c.req.param("id");
  const campaign = await getCampaign(c.env.DB, id);
  if (campaign === null) {
    return c.json({ error: "campaign_not_found" }, 404);
  }
  const url = new URL(c.req.url);
  const includeMissions = url.searchParams.get("include") === "missions";

  if (includeMissions) {
    // Hydrate each missionId. Could be a single `IN (...)` query, but
    // missions per campaign are bounded (3 in the seed, no realistic case
    // for v0.1 with > ~20). Parallel `getMission` calls share one D1
    // connection so the wall-clock cost is acceptable.
    const missionResults = await Promise.all(
      campaign.missionIds.map((mid) => getMission(c.env.DB, mid)),
    );
    const missions: Mission[] = missionResults.filter(
      (m): m is Mission => m !== null,
    );
    return c.json({ campaign, missions }, 200);
  }
  return c.json({ campaign }, 200);
});

export default campaigns;
