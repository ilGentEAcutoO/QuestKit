/**
 * mintToken — browser-side helper that fetches a fresh JWT from the demo
 * worker's POST /api/token proxy. The demo worker then forwards the
 * request to the real api worker (api.questkit.jairukchan.com/v1/auth/token)
 * with APP_SECRET injected server-side, so the browser never holds the
 * secret.
 *
 * In-memory cache: we keep the last-minted token + its `expiresAt` (ms
 * epoch) and reuse it until the lifetime drops below REFRESH_THRESHOLD_MS.
 * Refresh requests dedupe via `inFlight` so a render storm doesn't spam
 * the worker.
 */

interface MintResponse {
  token: string;
  expiresAt: number;
}

interface CacheEntry {
  token: string;
  expiresAt: number;
}

const REFRESH_THRESHOLD_MS = 60_000; // refresh if < 60s of life remaining

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<MintResponse>>();

async function fetchMint(userId: string): Promise<MintResponse> {
  const resp = await fetch("/api/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string };
      if (typeof body.error === "string") detail = body.error;
    } catch {
      // swallow body-read errors — the status alone is enough
    }
    throw new Error(`mintToken failed: ${detail}`);
  }
  const data = (await resp.json()) as MintResponse;
  if (typeof data.token !== "string" || typeof data.expiresAt !== "number") {
    throw new TypeError("mintToken: malformed response");
  }
  return data;
}

/**
 * Returns a cached or freshly minted token for the given userId. Safe to
 * call from every request hot path — cache hits are sync-fast and refresh
 * requests dedupe.
 */
export async function mintToken(userId: string): Promise<MintResponse> {
  const now = Date.now();
  const cached = cache.get(userId);
  if (cached && cached.expiresAt - now > REFRESH_THRESHOLD_MS) {
    return cached;
  }

  const pending = inFlight.get(userId);
  if (pending) return pending;

  const promise = fetchMint(userId)
    .then((res) => {
      cache.set(userId, { token: res.token, expiresAt: res.expiresAt });
      return res;
    })
    .finally(() => {
      inFlight.delete(userId);
    });
  inFlight.set(userId, promise);
  return promise;
}

/** Test/dev-tools helper: wipes the cached token so the next call mints fresh. */
export function clearTokenCache(userId?: string): void {
  if (userId === undefined) {
    cache.clear();
    return;
  }
  cache.delete(userId);
}
