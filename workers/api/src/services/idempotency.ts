/**
 * Idempotency cache layer — primary replay defence for /v1/events.
 *
 * Storage: Cloudflare KV (binding `CACHE`).
 *
 * Per plan §5 (Replay row) the TTL is 24 hours — anything older than that is
 * considered expired and re-processable. The route layer (routes/events.ts)
 * is the only writer; the cached value is the EXACT response body that was
 * returned the first time, so replays return byte-identical JSON.
 *
 * Key shape: `idem:${userId}:${idempotencyKey}` — scoped per-user so that two
 * different users picking the same UUIDv4 client-side don't collide. This
 * mirrors the partial unique index `idx_events_user_idem` declared in
 * migration 0001 (defence in depth).
 *
 * Note on type safety: `getCached` parses JSON and returns `T | null` via a
 * type assertion. The route is the sole writer so this assertion is safe in
 * practice; if a future migration adds writers from outside the route layer,
 * add zod validation here. JSON.parse can also throw on corrupted entries —
 * we let that bubble; pool-workers + KV runtime guarantee the value we put is
 * the value we get, modulo TTL expiry which would surface as null.
 *
 * KV type note: we rely on the global `KVNamespace` from the wrangler-
 * generated `worker-configuration.d.ts` (which extends the runtime types)
 * rather than importing from `@cloudflare/workers-types` — the two sources
 * disagree on the `.get()` overload signatures and the runtime types are
 * authoritative inside workerd.
 */

/** Cache TTL — plan §5 mandates 24h. */
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * Build the canonical KV key.
 *
 * Scope: per-user. Two different users may legitimately pick the same client-
 * side idempotency key (e.g. both SDKs generate UUIDv4 collisions, or both
 * use a deterministic key like `purchase_${orderId}` where orderId clashes
 * across tenants).
 */
export function key(userId: string, idempotencyKey: string): string {
  return `idem:${userId}:${idempotencyKey}`;
}

/**
 * Returns the cached response body if present, else null.
 *
 * The value was put as `JSON.stringify(response)`; we parse and assert the
 * caller's type. KV's `get(..., "text")` is the default behaviour; we call it
 * explicitly to make the parse boundary obvious.
 */
export async function getCached<T = unknown>(
  cache: KVNamespace,
  userId: string,
  idempotencyKey: string,
): Promise<T | null> {
  const raw = await cache.get(key(userId, idempotencyKey), "text");
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

/**
 * Stores a serialised response under the key with a 24h TTL.
 *
 * No-op if the key already exists? No — KV `put` is a blind write, which is
 * what we want for the DB-replay fallback (route re-builds the response then
 * caches; if a concurrent request already cached it the rewrite is harmless).
 */
export async function putCached<T = unknown>(
  cache: KVNamespace,
  userId: string,
  idempotencyKey: string,
  value: T,
): Promise<void> {
  await cache.put(key(userId, idempotencyKey), JSON.stringify(value), {
    expirationTtl: IDEMPOTENCY_TTL_SECONDS,
  });
}
