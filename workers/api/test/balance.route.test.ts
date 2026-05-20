/**
 * /v1/balance integration tests — TDD-first (TASK-010).
 *
 * Routes under test:
 *   GET /v1/balance
 *   GET /v1/balance/:currency
 *
 * Auth: JWT Bearer (requireAuth from TASK-007). Tokens minted directly via
 * sign() — see events.route.test.ts for the rationale.
 *
 * Side effects exercised:
 *   - D1 SELECT on balances
 *   - End-to-end mint (via /v1/missions/:id/claim) for the post-claim state.
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";
import { ensureUser, upsertProgress } from "../src/db/schema";

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

function getBalance(init: { token?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch("https://api.test/v1/balance", {
    method: "GET",
    headers,
  });
}

function getBalanceCurrency(
  currency: string,
  init: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch(
    `https://api.test/v1/balance/${encodeURIComponent(currency)}`,
    { method: "GET", headers },
  );
}

function postClaim(
  id: string,
  init: { token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (init.token !== undefined) headers.authorization = `Bearer ${init.token}`;
  return SELF.fetch(
    `https://api.test/v1/missions/${encodeURIComponent(id)}/claim`,
    { method: "POST", headers },
  );
}

interface Balance {
  userId: string;
  currency: string;
  amount: number;
  updatedAt: number;
}

// ----- 401 auth tests -----------------------------------------------------

describe("/v1/balance — auth", () => {
  it("returns 401 on GET /v1/balance without a JWT", async () => {
    const res = await getBalance();
    expect(res.status).toBe(401);
  });

  it("returns 401 on GET /v1/balance/:currency without a JWT", async () => {
    const res = await getBalanceCurrency("coin");
    expect(res.status).toBe(401);
  });
});

// ----- GET /v1/balance ----------------------------------------------------

describe("get /v1/balance", () => {
  it("returns { balances: [] } for a user with no balance rows", async () => {
    const userId = "u_balance_empty";
    const { token } = await mintToken(userId);
    const res = await getBalance({ token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balances: Balance[] };
    expect(body.balances).toEqual([]);
  });

  it("returns all balance rows after claiming a currency mission", async () => {
    const userId = "u_balance_after_claim";
    const { token } = await mintToken(userId);
    await ensureUser(env.DB, userId);
    await upsertProgress(env.DB, {
      userId,
      missionId: "mis_ecom_daily_purchase_3",
      status: "completed",
      progress: 1,
      currentCount: 3,
      targetCount: 3,
      updatedAt: Date.now(),
    });
    const claimRes = await postClaim("mis_ecom_daily_purchase_3", { token });
    expect(claimRes.status).toBe(200);

    const res = await getBalance({ token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balances: Balance[] };
    expect(body.balances.length).toBe(1);
    expect(body.balances[0]?.currency).toBe("coin");
    expect(body.balances[0]?.amount).toBe(100);
    expect(body.balances[0]?.userId).toBe(userId);
  });
});

// ----- GET /v1/balance/:currency -----------------------------------------

describe("get /v1/balance/:currency", () => {
  it("returns 200 + zero-state when the user has no row for that currency", async () => {
    const userId = "u_balance_currency_404";
    const { token } = await mintToken(userId);
    const res = await getBalanceCurrency("coin", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      balance: {
        userId: string;
        currency: string;
        amount: number;
        updatedAt: number;
      };
    };
    expect(body.balance.userId).toBe(userId);
    expect(body.balance.currency).toBe("coin");
    expect(body.balance.amount).toBe(0);
    expect(typeof body.balance.updatedAt).toBe("number");
  });

  it("returns 200 + zero-state for an unknown currency string", async () => {
    const userId = "u_balance_currency_unknown";
    const { token } = await mintToken(userId);
    const res = await getBalanceCurrency("totally_made_up", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      balance: { currency: string; amount: number };
    };
    expect(body.balance.currency).toBe("totally_made_up");
    expect(body.balance.amount).toBe(0);
  });

  it("returns 200 with the balance after a claim mints currency", async () => {
    const userId = "u_balance_currency_after_claim";
    const { token } = await mintToken(userId);
    await ensureUser(env.DB, userId);
    await upsertProgress(env.DB, {
      userId,
      missionId: "mis_ecom_daily_purchase_3",
      status: "completed",
      progress: 1,
      currentCount: 3,
      targetCount: 3,
      updatedAt: Date.now(),
    });
    await postClaim("mis_ecom_daily_purchase_3", { token });

    const res = await getBalanceCurrency("coin", { token });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { balance: Balance };
    expect(body.balance.amount).toBe(100);
    expect(body.balance.currency).toBe("coin");
    expect(body.balance.userId).toBe(userId);
  });
});
