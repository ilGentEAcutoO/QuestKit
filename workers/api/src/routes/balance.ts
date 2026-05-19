/**
 * /v1/balance — list / detail (TASK-010).
 *
 * All routes require auth (JWT Bearer via `requireAuth`).
 *
 * ## Routes
 *
 *   GET /v1/balance
 *     Returns `{ balances: Balance[] }` for every currency the caller has a
 *     row for. Empty array (not 404) when no balances exist — the user is
 *     legitimately "0 of everything" and the SDK can render that without a
 *     special case.
 *
 *   GET /v1/balance/:currency
 *     Returns `{ balance: Balance }` or 404 if the row doesn't exist.
 *     NOTE: 404 here means "the user has never had a balance in this
 *     currency", which clients should treat as "balance is 0" for display
 *     purposes. We pick 404 (truthful: the row doesn't exist) over a synthetic
 *     0-balance because callers can disambiguate "never minted" from
 *     "minted-then-decremented-to-zero" if they need to.
 */
import type { Balance } from "@questkit/types";
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";
import { getBalance, listBalances } from "../db/schema";

interface BalanceVars {
  userId: string;
  jti: string;
}

const balance = new Hono<{ Bindings: Env; Variables: BalanceVars }>();

balance.use("/*", requireAuth());

balance.get("/", async (c) => {
  const userId = c.var.userId;
  const balances = await listBalances(c.env.DB, userId);
  return c.json({ balances } satisfies { balances: Balance[] }, 200);
});

balance.get("/:currency", async (c) => {
  const userId = c.var.userId;
  const currency = c.req.param("currency");
  const row = await getBalance(c.env.DB, userId, currency);
  if (row === null) {
    return c.json({ error: "balance_not_found" }, 404);
  }
  return c.json({ balance: row } satisfies { balance: Balance }, 200);
});

export default balance;
