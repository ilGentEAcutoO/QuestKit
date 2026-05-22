/**
 * resolveDemoUserId — F2 hotfix spec (TASK-011 / v0.1.10).
 *
 * Locks the per-browser user-id resolver contract. The previous
 * implementation hardcoded `"demo_user_42"` for every visitor, which caused
 * cross-visitor server-side idempotency replays, mission completion-cap
 * collisions, and SSE leaks between concurrent browser sessions
 * (Playwright walkthrough at 2026-05-22 surfaced an apparent 0→2/3
 * Curious Mind jump on a single click because another visitor had
 * already pushed the mission to 1/3 first).
 *
 * Contract pinned here:
 *   1. localStorage hit (key `questkit_demo_user_id`, value matching
 *      /^demo_[\w-]+$/) → return the stored id, no new write, no UUID
 *      mint.
 *   2. localStorage miss → mint via `crypto.randomUUID().slice(0, 8)`
 *      → write to localStorage → return.
 *   3. `?user=<id>` query-param override always wins over localStorage
 *      (regex `/^[\w-]{3,40}$/` from v0.1.2). Don't even consult LS.
 *   4. localStorage.getItem throws (private mode / disabled storage) →
 *      fall through to per-tab unique `demo_${uuid}` without persisting.
 *      No throw escapes the call.
 *
 * Option A (chosen): the function is extracted to its own pure module
 * (`./demoUserId.ts`) so the test can stub `globalThis.window.location` /
 * `globalThis.window.localStorage` / `globalThis.crypto` per case without
 * `jest.isolateModules`. This mirrors the cleaner half of the patterns
 * in `useMissionClaim.test.tsx` and `Layout.test.tsx`.
 */
import { resolveDemoUserId } from "./demoUserId";

const STUB_UUID = "abc12345-0000-0000-0000-000000000000";
const STUB_UUID_PREFIX = "demo_abc12345";

// Save the real implementations so we can restore in afterEach. jsdom
// provides a real window.localStorage + window.location + crypto, but
// each test scrambles them, so we snapshot once at module load.
const originalLocation = window.location;
const originalCrypto = globalThis.crypto;

function setSearch(search: string): void {
  // Replace just the `search` portion of window.location. JSDOM's
  // `Location` is read-only on individual properties via assignment, so we
  // swap the entire object — same pattern react-router tests use.
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: new URL(`https://example.test/${search}`),
  });
}

function stubCryptoRandomUUID(value: string): jest.Mock<string, []> {
  const mock = jest.fn(() => value);
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    writable: true,
    value: { randomUUID: mock },
  });
  return mock;
}

function stubLocalStorage(impl: Partial<Storage>): {
  getItem: jest.Mock;
  setItem: jest.Mock;
} {
  const getItem = jest.fn(impl.getItem ?? (() => null));
  const setItem = jest.fn(impl.setItem ?? (() => {}));
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    writable: true,
    value: { getItem, setItem, removeItem: jest.fn(), clear: jest.fn() },
  });
  return { getItem, setItem };
}

describe("resolveDemoUserId — F2 hotfix (v0.1.10)", () => {
  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      writable: true,
      value: originalCrypto,
    });
    // Restore jsdom's native localStorage so other tests aren't poisoned.
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      writable: true,
      value:
        originalLocation === window.location
          ? window.localStorage
          : window.localStorage,
    });
    window.localStorage.clear();
  });

  it("returns the stored id from localStorage when present (no fresh mint)", () => {
    setSearch("");
    const uuidMock = stubCryptoRandomUUID(STUB_UUID);
    const { getItem, setItem } = stubLocalStorage({
      getItem: jest.fn((key) =>
        key === "questkit_demo_user_id" ? "demo_existing1" : null,
      ),
    });

    const result = resolveDemoUserId();

    expect(result).toBe("demo_existing1");
    expect(getItem).toHaveBeenCalledWith("questkit_demo_user_id");
    expect(setItem).not.toHaveBeenCalled();
    expect(uuidMock).not.toHaveBeenCalled();
  });

  it("mints a fresh id, writes it to localStorage, and returns it on cold start", () => {
    setSearch("");
    const uuidMock = stubCryptoRandomUUID(STUB_UUID);
    const { getItem, setItem } = stubLocalStorage({
      getItem: jest.fn(() => null),
    });

    const result = resolveDemoUserId();

    expect(result).toBe(STUB_UUID_PREFIX);
    expect(getItem).toHaveBeenCalledWith("questkit_demo_user_id");
    expect(uuidMock).toHaveBeenCalledTimes(1);
    expect(setItem).toHaveBeenCalledWith(
      "questkit_demo_user_id",
      STUB_UUID_PREFIX,
    );
  });

  it("honours the ?user= query override over localStorage", () => {
    setSearch("?user=test_abc");
    const uuidMock = stubCryptoRandomUUID(STUB_UUID);
    const { getItem, setItem } = stubLocalStorage({
      getItem: jest.fn(() => "demo_should_be_ignored"),
    });

    const result = resolveDemoUserId();

    expect(result).toBe("test_abc");
    // ?user= short-circuits before any LS / UUID work happens.
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(uuidMock).not.toHaveBeenCalled();
  });

  it("falls back to a per-tab unique id when localStorage.getItem throws", () => {
    setSearch("");
    const uuidMock = stubCryptoRandomUUID(STUB_UUID);
    const { setItem } = stubLocalStorage({
      getItem: jest.fn(() => {
        // Simulate Safari private mode / SecurityError.
        throw new Error("storage disabled");
      }),
    });

    const result = resolveDemoUserId();

    expect(result).toBe(STUB_UUID_PREFIX);
    // We must NOT have attempted to persist (the getItem throw is the
    // signal that .setItem would also fail; we don't add a second
    // failure surface). The catch returns the unpersisted minted id.
    expect(setItem).not.toHaveBeenCalled();
    // The UUID path still ran exactly once for the returned id.
    expect(uuidMock).toHaveBeenCalledTimes(1);
  });
});
