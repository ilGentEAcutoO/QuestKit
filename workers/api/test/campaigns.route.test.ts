/**
 * /v1/campaigns integration tests — TDD-first (TASK-010).
 *
 * Routes under test:
 *   GET /v1/campaigns
 *   GET /v1/campaigns/:id
 *
 * Auth: JWT Bearer (requireAuth from TASK-007). Tokens minted directly via
 * sign() — see events.route.test.ts for the rationale.
 *
 * Seed campaigns (from migration 0002):
 *   - camp_ecom_2026q2   — 3 missions (mis_ecom_*)
 *   - camp_stream_2026q2 — 3 missions (mis_stream_*)
 *
 * Both run from 2026-04-01 to 2026-06-30; "today" in the test runtime is
 * Date.now() — these tests are time-stable against the seed window because we
 * don't pin a fake `now`.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";

const JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function mintToken(
  userId: string,
  overrides: Partial<JwtPayload> = {},
): Promise<{ token: string }> {
  const iat = nowSec();
  const exp = iat + 3600;
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const payload: JwtPayload = { sub: userId, iat, exp, jti, ...overrides };
  const token = await sign(payload, JWT_SECRET);
  return { token };
}

function getCampaigns(
  query: string,
  init: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch(`https://api.test/v1/campaigns${query}`, {
    method: "GET",
    headers,
  });
}

function getCampaignById(
  id: string,
  query: string = "",
  init: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch(
    `https://api.test/v1/campaigns/${encodeURIComponent(id)}${query}`,
    { method: "GET", headers },
  );
}

interface Campaign {
  id: string;
  title: string;
  description: string;
  startAt: number;
  endAt: number;
  missionIds: string[];
}

interface Mission {
  id: string;
  title: string;
}

interface CampaignListResp {
  campaigns: Campaign[];
}

interface CampaignDetailResp {
  campaign: Campaign;
  missions?: Mission[];
}

// ----- 401 auth tests -----------------------------------------------------

describe("/v1/campaigns — auth", () => {
  it("returns 401 on GET /v1/campaigns without a JWT", async () => {
    const res = await getCampaigns("");
    expect(res.status).toBe(401);
  });

  it("returns 401 on GET /v1/campaigns/:id without a JWT", async () => {
    const res = await getCampaignById("camp_ecom_2026q2");
    expect(res.status).toBe(401);
  });
});

// ----- GET /v1/campaigns --------------------------------------------------

describe("get /v1/campaigns", () => {
  it("returns both seed campaigns (active today)", async () => {
    const userId = "u_list_campaigns_1";
    const { token } = await mintToken(userId);
    const res = await getCampaigns("", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CampaignListResp;
    expect(body.campaigns.length).toBe(2);
    const ids = body.campaigns.map((c) => c.id).sort();
    expect(ids).toEqual(["camp_ecom_2026q2", "camp_stream_2026q2"]);

    // Each campaign carries its mission ids.
    const ecom = body.campaigns.find((c) => c.id === "camp_ecom_2026q2");
    expect(ecom?.missionIds.length).toBe(3);
  });

  it("?include=expired still returns both campaigns (they're already inside the active filter today)", async () => {
    const userId = "u_list_campaigns_include_expired";
    const { token } = await mintToken(userId);
    const res = await getCampaigns("?include=expired", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CampaignListResp;
    expect(body.campaigns.length).toBe(2);
  });
});

// ----- GET /v1/campaigns/:id ---------------------------------------------

describe("get /v1/campaigns/:id", () => {
  it("returns the campaign with missionIds populated", async () => {
    const userId = "u_get_campaign_1";
    const { token } = await mintToken(userId);
    const res = await getCampaignById("camp_ecom_2026q2", "", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CampaignDetailResp;
    expect(body.campaign.id).toBe("camp_ecom_2026q2");
    expect(body.campaign.title).toBe("E-commerce Spring 2026");
    expect(body.campaign.missionIds.length).toBe(3);
    expect(body.campaign.missionIds.sort()).toEqual([
      "mis_ecom_daily_purchase_3",
      "mis_ecom_electronics_50",
      "mis_ecom_variety_week",
    ]);
    // Without ?include=missions, the missions[] is undefined.
    expect(body.missions).toBeUndefined();
  });

  it("?include=missions hydrates the missions[] in the response", async () => {
    const userId = "u_get_campaign_with_missions";
    const { token } = await mintToken(userId);
    const res = await getCampaignById("camp_ecom_2026q2", "?include=missions", {
      token,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CampaignDetailResp;
    expect(body.missions).toBeDefined();
    expect(body.missions?.length).toBe(3);
    const ids = body.missions?.map((m) => m.id).sort();
    expect(ids).toEqual([
      "mis_ecom_daily_purchase_3",
      "mis_ecom_electronics_50",
      "mis_ecom_variety_week",
    ]);
  });

  it("returns 404 campaign_not_found on a nonexistent id", async () => {
    const userId = "u_get_campaign_404";
    const { token } = await mintToken(userId);
    const res = await getCampaignById("nonexistent_campaign", "", { token });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("campaign_not_found");
  });
});
