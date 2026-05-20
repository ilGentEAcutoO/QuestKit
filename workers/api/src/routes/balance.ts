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
 *     Returns `{ balance: Balance }` — always 200. When the user has never
 *     had a row for this currency, returns a synthetic `{ amount: 0,
 *     updatedAt: Date.now() }` zero-state. Previously this returned 404
 *     to let callers distinguish "never minted" from "decremented-to-0",
 *     but in practice every consumer renders both as "0 coin" and the
 *     404 generated noisy browser console errors. The graceful empty-
 *     state is the right call.
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
  // Graceful empty-state: synthesize a zero balance when the row doesn't
  // exist. Same shape as a real Balance — consumers render it identically.
  const balance: Balance = row ?? {
    userId,
    currency,
    amount: 0,
    updatedAt: Date.now(),
  };
  return c.json({ balance } satisfies { balance: Balance }, 200);
});

export default balance;
