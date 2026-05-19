/**
 * Platform-agnostic key-value storage abstraction.
 *
 * The SDK persists the event queue across page reloads / tab restores so
 * events generated while offline aren't lost. Browsers get `localStorage`;
 * Node / SSR / private-mode browsers get an in-memory fallback. The
 * adapter contract is intentionally minimal — three methods — so we don't
 * leak storage-engine quirks (quota errors, async APIs) into call-sites.
 */

export interface Storage {
  get: (key: string) => string | null;
  set: (key: string, value: string) => void;
  remove: (key: string) => void;
}

/**
 * Browser `localStorage` adapter. Each method is defensive: localStorage
 * can throw on access (private mode, exceeded quota, certain Safari
 * versions). Swallowed errors degrade to "treat as not stored" which is
 * the safe default for a queue that retries.
 */
export class LocalStorageAdapter implements Storage {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota exceeded / unavailable — silently drop. The queue will retry
      // on the next event; persistent unavailability means we behave as if
      // it were a MemoryStorage instance for the rest of the session.
    }
  }

  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // see set()
    }
  }
}

/**
 * In-memory fallback. Backed by a Map for O(1) operations and clean iteration
 * semantics. Used in Node, SSR, private browsing, or whenever localStorage
 * probes throw.
 */
export class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.data.set(key, value);
  }

  remove(key: string): void {
    this.data.delete(key);
  }
}

/**
 * Auto-detect the best storage adapter for the current platform.
 *
 * Order of preference:
 *   1. `window.localStorage` (if accessible and writable)
 *   2. In-memory fallback
 *
 * We probe with a write-then-remove because some browsers expose
 * `localStorage` but throw on `setItem` (e.g. Safari Private mode pre-2017,
 * some embedded WebViews).
 */
export function detectStorage(): Storage {
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.localStorage !== "undefined" &&
      window.localStorage !== null
    ) {
      const probeKey = "__qk_probe__";
      window.localStorage.setItem(probeKey, "1");
      window.localStorage.removeItem(probeKey);
      return new LocalStorageAdapter();
    }
  } catch {
    // Probe failed — fall through to memory.
  }
  return new MemoryStorage();
}
