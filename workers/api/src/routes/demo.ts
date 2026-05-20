/**
 * /v1/demo — demo-user utilities (Phase 8 / TASK-003).
 *
 * The single route today is `POST /v1/demo/reset`, which wipes the caller's
 * server-side state so the demo UI can offer a "fresh start" button that
 * actually resets state (the previous Phase 6 implementation only cleared
 * localStorage — server-side progress, balances, and events persisted, so
 * "claimed" missions stayed claimed across reloads).
 *
 * ## Security model
 *
 * This endpoint is destructive — anyone who can call it wipes the entire
 * server-side history for one user. We gate it with two complementary
 * checks that BOTH must pass; either failing yields 403 (not 401 — the
 * token is valid; the user just isn't permitted to use this endpoint):
 *
 *   1. JWT must carry `kind === "demo"`.
 *      Set by the demo mint proxy (`apps/demo/src/server/index.ts`) when
 *      it forwards `/api/token` to upstream `/v1/auth/token`. Regular
 *      mint paths omit the claim, so production tokens cannot trip the
 *      reset even if they impersonate a `demo_*` userId.
 *
 *   2. userId (JWT `sub`) must start with `demo_`.
 *      Defence in depth — even if an operator misconfigures the mint
 *      proxy to leak `kind: "demo"` to real users, the userId prefix
 *      guard prevents a paid customer's data from being wiped.
 *
 * The guard runs BEFORE any DB op — see the early return in the handler.
 *
 * ## Wipe scope
 *
 * D1 (atomic via `db.batch`):
 *   - `events` for the user
 *   - `mission_progress` for the user
 *   - `balances` for the user
 *
 * KV (best-effort — KV does not have a transactional list+delete):
 *   - `idem:${userId}:*` — per-user-per-event idempotency cache. Listed
 *     via `CACHE.list({ prefix })` and deleted individually, paginated.
 *   - `rec:${userId}` — AI recommendations cache (single key, exact match).
 *
 * The KV deletes are best-effort because:
 *   1. KV is eventually consistent; a list page may miss a just-written key.
 *   2. There's no batch-delete primitive — we issue N round-trips.
 *   3. Even if a key survives, the worst outcome is a stale idempotency
 *      replay or a stale recommendation — neither is dangerous.
 *
 * The DB wipe IS atomic via `db.batch([...])`, so a caller can rely on
 * "if the response is 200, the DB is clean".
 *
 * ## Response shape
 *
 *   200: { ok: true }
 *   401: missing/invalid JWT (from `requireAuth`)
 *   403: { error: "not_demo_user" } — either gate failed
 *
 * Idempotent: calling twice on an already-empty user still returns 200.
 */
import { Hono } from "hono";
import { requireAuth } from "../auth/middleware";

interface DemoVars {
  userId: string;
  jti: string;
  kind: "demo" | undefined;
}

const demo = new Hono<{ Bindings: Env; Variables: DemoVars }>();

demo.use("/*", requireAuth());

/**
 * KV list/delete loop. Cloudflare KV `list` is paginated; we walk every
 * page until `list_complete: true` and issue individual `delete` calls per
 * key. We don't `Promise.all` the deletes because workerd allows up to ~6
 * concurrent subrequests per request and KV deletes are subrequests — a
 * burst of hundreds would trip the limit. The sequential loop is bounded
 * by the user's footprint, which the rule engine + idempotency TTL keep
 * small (24h cache).
 */
async function deleteKvKeysWithPrefix(
  cache: KVNamespace,
  prefix: string,
): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const listOpts: { prefix: string; cursor?: string } = { prefix };
    if (cursor !== undefined) listOpts.cursor = cursor;
    const page = await cache.list(listOpts);
    for (const { name } of page.keys) {
      await cache.delete(name);
    }
    if (page.list_complete) return;
    // Defensive: if `cursor` is missing despite list_complete being false,
    // break to avoid an infinite loop. This shouldn't happen per the KV
    // API contract, but we guard anyway.
    if (page.cursor === undefined) return;
    cursor = page.cursor;
  }
}

demo.post("/reset", async (c) => {
  const userId = c.var.userId;
  const kind = c.var.kind;

  // ---------------------------------------------------------------------
  // Security gate — both conditions MUST pass. We deliberately use a
  // generic error code ("not_demo_user") for both failure modes so an
  // attacker can't distinguish "missing kind claim" from "wrong userId
  // prefix"; either way they get the same 403 + body.
  //
  // The check runs BEFORE any DB op. Self-review: a refused request must
  // not touch state.
  // ---------------------------------------------------------------------
  if (kind !== "demo" || !userId.startsWith("demo_")) {
    return c.json({ error: "not_demo_user" }, 403);
  }

  // ---------------------------------------------------------------------
  // D1 wipe — atomic via db.batch. Three DELETEs in one transaction.
  //
  // Order doesn't matter (these tables are independent — no FK chains
  // between events/mission_progress/balances that require a specific
  // order). We list them alphabetically for readability.
  // ---------------------------------------------------------------------
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM balances WHERE user_id = ?1").bind(userId),
    c.env.DB.prepare("DELETE FROM events WHERE user_id = ?1").bind(userId),
    c.env.DB.prepare("DELETE FROM mission_progress WHERE user_id = ?1").bind(
      userId,
    ),
  ]);

  // ---------------------------------------------------------------------
  // KV wipe — best-effort. See file-level JSDoc for the rationale on why
  // this is not transactional with the DB wipe.
  // ---------------------------------------------------------------------
  await deleteKvKeysWithPrefix(c.env.CACHE, `idem:${userId}:`);
  await c.env.CACHE.delete(`rec:${userId}`);

  return c.json({ ok: true }, 200);
});

export default demo;
