/**
 * resolveDemoUserId — return a stable demo user id for THIS browser session.
 *
 * Behaviour (v0.1.10 / TASK-011 / F2 fix — was previously a hardcoded
 * `demo_user_42` shared across every visitor, which caused server-side
 * idempotency replays, mission completion-cap collisions, and cross-visitor
 * SSE leaks once two browsers were active at the same time):
 *
 *   1. SSR fallback (`typeof window === "undefined"`) → returns the legacy
 *      `"demo_user_42"` placeholder so the import-time call in `client.tsx`
 *      stays SSR-safe. Production runs render client-only so this branch
 *      never executes for real users.
 *
 *   2. `?user=<id>` query-param override (regex `/^[\w-]{3,40}$/`) — unchanged
 *      from v0.1.9. Used by `apps/demo/e2e/golden-path.spec.ts` and manual
 *      test sessions that need a deterministic id.
 *
 *   3. `window.localStorage["questkit_demo_user_id"]` — if present and
 *      matches `/^demo_[\w-]+$/`, return it. This is the persistent
 *      per-browser id.
 *
 *   4. Otherwise mint a fresh id (`demo_${crypto.randomUUID().slice(0, 8)}`),
 *      write it back to localStorage, and return it. Each browser then
 *      keeps the same id across reloads / route changes / new tabs of
 *      the same origin.
 *
 *   5. Re-mint trigger: any of `localStorage.getItem` / `.setItem` throwing
 *      (private mode, quota-exceeded, disabled storage). In that case we
 *      fall through to a per-tab unique id (still `demo_${uuid8}`) without
 *      persisting it — the user simply gets a fresh user on every reload
 *      instead of crashing.
 *
 *   6. Re-mint also happens implicitly when a user clears site data — the
 *      next call sees an empty localStorage and runs the mint path again.
 *
 * The function is intentionally pure of side-effects beyond the
 * try/catch'd localStorage.setItem and is exported for unit testing
 * (`apps/demo/src/lib/client.test.tsx`). It's re-imported by `client.tsx`
 * at module load (`DEMO_USER_ID = resolveDemoUserId()`), which is fine
 * because the id is stable per-browser — module-load timing matches the
 * SPA lifecycle, and the second-call path (LS hit) is idempotent.
 */
const LS_KEY = "questkit_demo_user_id";
const USER_QUERY_REGEX = /^[\w-]{3,40}$/;
const LS_VALUE_REGEX = /^demo_[\w-]+$/;

/**
 * Mint a fresh `demo_${uuid8}` id from `crypto.randomUUID()`.
 * Caller must guarantee `crypto.randomUUID` exists (all modern browsers do).
 */
function mintFreshId(): string {
  return `demo_${crypto.randomUUID().slice(0, 8)}`;
}

export function resolveDemoUserId(): string {
  // SSR safety — Vite SSR / unit tests without jsdom hit this branch.
  if (typeof window === "undefined") return "demo_user_42";

  // (2) Explicit override via query string always wins. Read once at
  // module-load — the SPA never rewrites the URL search portion.
  const param = new URLSearchParams(window.location.search).get("user");
  if (param !== null && USER_QUERY_REGEX.test(param)) return param;

  // (3) + (4) + (5) localStorage lookup / mint with full try/catch around
  // EVERY localStorage touch. Private mode in Safari throws on .setItem;
  // some browsers throw on .getItem too if storage is disabled.
  try {
    const stored = window.localStorage.getItem(LS_KEY);
    if (stored !== null && LS_VALUE_REGEX.test(stored)) {
      return stored;
    }
    const fresh = mintFreshId();
    window.localStorage.setItem(LS_KEY, fresh);
    return fresh;
  } catch {
    // (5) Storage disabled / quota exceeded — return a per-tab unique id.
    // No persistence; the user gets a fresh id on the next reload. Better
    // than crashing the bootstrap.
    return mintFreshId();
  }
}
