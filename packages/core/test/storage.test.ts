/**
 * @jest-environment jsdom
 *
 * The storage adapter probes `window.localStorage`; we need jsdom for that.
 * Other test files default to the `node` environment (which has fetch /
 * Response / streams built-in).
 */
import {
  detectStorage,
  LocalStorageAdapter,
  MemoryStorage,
} from "../src/storage";

describe("memoryStorage", () => {
  it("get returns null when unset", () => {
    const s = new MemoryStorage();
    expect(s.get("nope")).toBeNull();
  });

  it("set + get round-trips", () => {
    const s = new MemoryStorage();
    s.set("k", "v");
    expect(s.get("k")).toBe("v");
  });

  it("remove deletes a key", () => {
    const s = new MemoryStorage();
    s.set("k", "v");
    s.remove("k");
    expect(s.get("k")).toBeNull();
  });

  it("isolates instances", () => {
    const a = new MemoryStorage();
    const b = new MemoryStorage();
    a.set("k", "v");
    expect(b.get("k")).toBeNull();
  });
});

describe("localStorageAdapter (jsdom)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("delegates get / set / remove to window.localStorage", () => {
    const s = new LocalStorageAdapter();
    s.set("k", "v");
    expect(window.localStorage.getItem("k")).toBe("v");
    expect(s.get("k")).toBe("v");
    s.remove("k");
    expect(s.get("k")).toBeNull();
  });

  it("get returns null on access error", () => {
    const s = new LocalStorageAdapter();
    // jsdom's localStorage is exposed via a getter on Storage.prototype.
    // We monkey-patch the prototype method directly rather than using
    // jest.spyOn (which doesn't return a configurable function in jsdom).
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const orig = proto.getItem;
    proto.getItem = () => {
      throw new Error("denied");
    };
    try {
      expect(s.get("k")).toBeNull();
    } finally {
      proto.getItem = orig;
    }
  });

  it("set + remove swallow errors silently", () => {
    const s = new LocalStorageAdapter();
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const origSet = proto.setItem;
    const origRemove = proto.removeItem;
    proto.setItem = () => {
      throw new Error("quota");
    };
    proto.removeItem = () => {
      throw new Error("denied");
    };
    try {
      expect(() => s.set("k", "v")).not.toThrow();
      expect(() => s.remove("k")).not.toThrow();
    } finally {
      proto.setItem = origSet;
      proto.removeItem = origRemove;
    }
  });
});

describe("detectStorage", () => {
  it("returns a LocalStorageAdapter in jsdom (window exists)", () => {
    const s = detectStorage();
    expect(s).toBeInstanceOf(LocalStorageAdapter);
  });

  it("falls back to MemoryStorage when the probe throws", () => {
    const proto = Object.getPrototypeOf(window.localStorage) as Storage;
    const origSet = proto.setItem;
    proto.setItem = () => {
      throw new Error("private mode");
    };
    try {
      const s = detectStorage();
      expect(s).toBeInstanceOf(MemoryStorage);
    } finally {
      proto.setItem = origSet;
    }
  });
});
