/**
 * ai.ts service tests — TDD-first (TASK-017).
 *
 * The service is pure-ish: it takes (env, userId, recentEvents, activeMissions)
 * and returns { missionIds, reason, cached }. It depends on `env.AI` (Workers AI
 * binding) and `env.CACHE` (KV).
 *
 * We construct a hand-rolled fake `env` for each test rather than the
 * pool-workers `env` from cloudflare:test, because:
 *   - `wrangler.test.jsonc` does not declare the `ai` binding (see header
 *     comment of that file — Workers AI has no local emulator).
 *   - The service is decoupled from Hono and routing, so a minimal env shape
 *     ({ AI, CACHE }) is the right test surface.
 *
 * Tests we own:
 *   1. Cache HIT — AI binding NOT called, returns { ...cached, cached: true }.
 *   2. Cache MISS — AI binding called with the expected `messages` shape and
 *      result is returned with cached:false; KV put fired with the 1h TTL.
 *   3. Malformed AI response (text without JSON) — returns fallback (does NOT
 *      throw, does NOT pollute the cache). Phase 8 / v0.1.4 TASK-002.
 *   4. Hallucinated mission ID — IDs not in `activeMissions` are filtered out.
 *   5. System prompt is sent verbatim (the brief locked the exact wording).
 *   6. Security — event payload VALUES are NEVER serialised into the user
 *      message (only name + count + missionId + criteria.eventName / count).
 *   7. Envelope-shape acceptance — `@cf/meta/llama-3.1-8b-instruct-fast` may
 *      return the payload under `{response: string}`, `{result: object}`, or
 *      as a raw object. All three must parse to the same result.
 */
import type { Event, Mission } from "@questkit/types";
import { describe, expect, it, vi } from "vitest";
import { recommendMissions } from "../src/services/ai";

// -----------------------------------------------------------------------------
// Fake bindings — we don't use cloudflare:test here.
// -----------------------------------------------------------------------------

/**
 * Build a minimal in-memory KV stub. Stores `.put(key, json, opts)` so tests
 * can assert TTL and roundtrip values via `.get(key, "json")`. This mirrors
 * the actual KVNamespace API surface we use in ai.ts.
 */
function makeKvStub(initial: Record<string, string> = {}): {
  kv: KVNamespace;
  store: Map<string, { value: string; ttl?: number }>;
} {
  const store = new Map<string, { value: string; ttl?: number }>();
  for (const [k, v] of Object.entries(initial)) {
    store.set(k, { value: v });
  }
  const kv = {
    get: vi
      .fn()
      .mockImplementation(
        async (
          key: string,
          type?: "text" | "json",
        ): Promise<string | unknown | null> => {
          const entry = store.get(key);
          if (entry === undefined) return null;
          if (type === "json") return JSON.parse(entry.value);
          return entry.value;
        },
      ),
    put: vi
      .fn()
      .mockImplementation(
        async (
          key: string,
          value: string,
          opts?: { expirationTtl?: number },
        ): Promise<void> => {
          const entry: { value: string; ttl?: number } = { value };
          if (typeof opts?.expirationTtl === "number") {
            entry.ttl = opts.expirationTtl;
          }
          store.set(key, entry);
        },
      ),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
  return { kv, store };
}

/**
 * Build a fake AI binding. `run` returns whatever the test specifies. The
 * Workers AI return shape for text generation is `{ response: string, ... }`.
 */
function makeAiStub(
  runImpl: (
    model: string,
    inputs: Record<string, unknown>,
  ) => Promise<unknown> | unknown,
): { ai: Ai; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (model: string, inputs: Record<string, unknown>) =>
    runImpl(model, inputs),
  );
  const ai = { run } as unknown as Ai;
  return { ai, run };
}

/**
 * Build an env stub with just AI + CACHE — the only bindings ai.ts uses.
 */
function makeEnv(ai: Ai, cache: KVNamespace): Pick<Env, "AI" | "CACHE"> {
  return { AI: ai, CACHE: cache };
}

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

const missionA: Mission = {
  id: "mis_a",
  title: "A",
  description: "",
  criteria: { eventName: "purchase.completed", count: 3, window: "daily" },
  reward: { kind: "currency", currency: "coin", amount: 100 },
};

const missionB: Mission = {
  id: "mis_b",
  title: "B",
  description: "",
  criteria: { eventName: "video.watched", count: 1, window: "daily" },
  reward: { kind: "currency", currency: "coin", amount: 20 },
};

const missionC: Mission = {
  id: "mis_c",
  title: "C",
  description: "",
  criteria: { eventName: "review.posted", count: 1, window: "lifetime" },
  reward: { kind: "badge", badgeId: "reviewer" },
};

const purchaseEvent: Event = {
  userId: "u1",
  name: "purchase.completed",
  // The payload values below MUST NEVER reach the user-msg sent to the LLM.
  // Specifically: "secret_data", "5551234567" — these are the canaries for the
  // prompt-injection assertion (test 6).
  payload: {
    secret_data: "5551234567",
    amount: 42,
    category: "electronics",
  },
  timestamp: 1_700_000_000_000,
};

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("recommendMissions — cache HIT path", () => {
  it("returns the cached value with cached:true and DOES NOT call env.AI.run", async () => {
    const cached = { missionIds: ["mis_a"], reason: "Welcome back!" };
    const { kv } = makeKvStub({
      "rec:u1": JSON.stringify(cached),
    });
    const { ai, run } = makeAiStub(async () => {
      throw new Error("env.AI.run should NOT have been called on cache HIT");
    });
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA, missionB]);

    expect(result).toEqual({ ...cached, cached: true });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("recommendMissions — cache MISS path", () => {
  it("calls env.AI.run with the canonical model id, locked system prompt, and persisted user-msg", async () => {
    const { kv, store } = makeKvStub();
    const aiBody = {
      missionIds: ["mis_a"],
      reason: "You’ve been on a streak.",
    };
    const { ai, run } = makeAiStub(async () => ({
      response: JSON.stringify(aiBody),
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(
      env,
      "u1",
      [purchaseEvent],
      [missionA, missionB],
    );

    expect(result).toEqual({ ...aiBody, cached: false });
    expect(run).toHaveBeenCalledTimes(1);
    const callArgs = run.mock.calls[0];
    if (callArgs === undefined) throw new Error("expected one call");
    const model = callArgs[0];
    const inputs = callArgs[1] as {
      messages: { role: string; content: string }[];
    };
    // Model id — v0.1.6 hotfix moved off the `-fast` variant after it
    // returned 100% AI binding throws in prod (TASK-006). DO NOT change
    // again without redoing the diagnostic recipe in test-report.md.
    expect(model).toBe("@cf/meta/llama-3.1-8b-instruct");
    expect(inputs.messages).toHaveLength(2);
    const sys = inputs.messages[0];
    const usr = inputs.messages[1];
    if (sys === undefined || usr === undefined) {
      throw new Error("expected two messages (system + user)");
    }
    expect(sys.role).toBe("system");
    expect(usr.role).toBe("user");

    // Result cached for 1h.
    const cacheEntry = store.get("rec:u1");
    expect(cacheEntry).toBeDefined();
    expect(cacheEntry?.ttl).toBe(3600);
    expect(JSON.parse(cacheEntry?.value ?? "{}")).toEqual(aiBody);
  });

  it("sends the locked system prompt VERBATIM", async () => {
    const { kv } = makeKvStub();
    const aiBody = { missionIds: [], reason: "hi" };
    const { ai, run } = makeAiStub(async () => ({
      response: JSON.stringify(aiBody),
    }));
    const env = makeEnv(ai, kv);

    await recommendMissions(env, "u1", [], [missionA]);

    const callArgs = run.mock.calls[0];
    if (callArgs === undefined) throw new Error("expected one call");
    const inputs = callArgs[1] as {
      messages: { role: string; content: string }[];
    };
    const sys = inputs.messages[0]?.content ?? "";

    // The brief locked these exact strings — copy/paste from the brief.
    expect(sys).toContain("You are an encouraging gamification coach.");
    expect(sys).toContain("Return ONLY valid JSON");
    expect(sys).toContain('{ "missionIds": string[], "reason": string }');
    expect(sys).toContain("Max 30 words.");
    expect(sys).toContain("No prose.");
  });
});

describe("recommendMissions — security (prompt-injection guard)", () => {
  it("does NOT include event payload VALUES in the user message", async () => {
    const { kv } = makeKvStub();
    const aiBody = { missionIds: ["mis_a"], reason: "hi" };
    const { ai, run } = makeAiStub(async () => ({
      response: JSON.stringify(aiBody),
    }));
    const env = makeEnv(ai, kv);

    await recommendMissions(
      env,
      "u1",
      [purchaseEvent],
      [missionA, missionB, missionC],
    );

    const callArgs = run.mock.calls[0];
    if (callArgs === undefined) throw new Error("expected one call");
    const inputs = callArgs[1] as {
      messages: { role: string; content: string }[];
    };
    const userContent = inputs.messages[1]?.content ?? "";

    // Canary values from purchaseEvent.payload — these MUST NEVER reach the LLM.
    expect(userContent).not.toContain("5551234567");
    expect(userContent).not.toContain("secret_data");
    expect(userContent).not.toContain("electronics");
    // The event NAME, by contrast, IS allowed (we summarise name + count).
    expect(userContent).toContain("purchase.completed");
  });
});

describe("recommendMissions — AI response validation (fallback path, no throw)", () => {
  it("returns fallback when the AI returns text without parseable JSON", async () => {
    const { kv, store } = makeKvStub();
    const { ai } = makeAiStub(async () => ({
      response: "I am a model and I cannot follow JSON instructions today.",
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA]);

    expect(result.fallback).toBe(true);
    expect(result.missionIds).toEqual([]);
    expect(result.cached).toBe(false);
    expect(typeof result.reason).toBe("string");
    // Fallback must NOT pollute the KV cache — next call should retry the AI.
    expect(store.get("rec:u1")).toBeUndefined();
  });

  it("returns fallback when missionIds is not a string array", async () => {
    const { kv, store } = makeKvStub();
    const { ai } = makeAiStub(async () => ({
      response: JSON.stringify({ missionIds: "mis_a", reason: "hi" }),
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA]);
    expect(result.fallback).toBe(true);
    expect(result.missionIds).toEqual([]);
    expect(store.get("rec:u1")).toBeUndefined();
  });

  it("returns fallback when reason is missing", async () => {
    const { kv, store } = makeKvStub();
    const { ai } = makeAiStub(async () => ({
      response: JSON.stringify({ missionIds: ["mis_a"] }),
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA]);
    expect(result.fallback).toBe(true);
    expect(result.missionIds).toEqual([]);
    expect(store.get("rec:u1")).toBeUndefined();
  });

  it("drops hallucinated mission IDs that are not in activeMissions", async () => {
    // The LLM returns mis_a (valid), mis_hallucinated (not in the list), and
    // mis_b (valid). We expect only mis_a + mis_b in the output. The reason
    // stays untouched.
    const { kv } = makeKvStub();
    const aiBody = {
      missionIds: ["mis_a", "mis_hallucinated", "mis_b"],
      reason: "Try these.",
    };
    const { ai } = makeAiStub(async () => ({
      response: JSON.stringify(aiBody),
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA, missionB]);

    expect(result.missionIds).toEqual(["mis_a", "mis_b"]);
    expect(result.reason).toBe("Try these.");
    expect(result.cached).toBe(false);
    expect(result.fallback).toBeFalsy();
  });
});

// -----------------------------------------------------------------------------
// Envelope-shape acceptance (Phase 8 / v0.1.4 TASK-002).
// `@cf/meta/llama-3.1-8b-instruct-fast` can return the JSON payload under any
// of these envelopes; the parser must accept all three before falling back.
// -----------------------------------------------------------------------------

describe("recommendMissions — envelope shape acceptance", () => {
  const aiBody = { missionIds: ["mis_a"], reason: "Welcome back." };

  it("shape 1: {response: string} — parses the .response JSON string", async () => {
    const { kv, store } = makeKvStub();
    const { ai } = makeAiStub(async () => ({
      response: JSON.stringify(aiBody),
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA]);
    expect(result.fallback).toBeFalsy();
    expect(result.missionIds).toEqual(["mis_a"]);
    expect(result.reason).toBe("Welcome back.");
    // Happy-path result MUST be cached.
    expect(store.get("rec:u1")).toBeDefined();
  });

  it("shape 2: {result: object} — uses .result as the parsed payload", async () => {
    const { kv, store } = makeKvStub();
    const { ai } = makeAiStub(async () => ({
      result: aiBody,
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA]);
    expect(result.fallback).toBeFalsy();
    expect(result.missionIds).toEqual(["mis_a"]);
    expect(result.reason).toBe("Welcome back.");
    expect(store.get("rec:u1")).toBeDefined();
  });

  it("shape 3: raw object — the AI returns the payload at the top level", async () => {
    const { kv, store } = makeKvStub();
    const { ai } = makeAiStub(async () => aiBody);
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA]);
    expect(result.fallback).toBeFalsy();
    expect(result.missionIds).toEqual(["mis_a"]);
    expect(result.reason).toBe("Welcome back.");
    expect(store.get("rec:u1")).toBeDefined();
  });

  it("shape 2 with .response field that is NOT a string falls through to .result", async () => {
    // Defensive: some Workers AI variants set .response: null and put the data
    // under .result. The normalizer must not get stuck on a non-string .response.
    const { kv } = makeKvStub();
    const { ai } = makeAiStub(async () => ({
      response: null,
      result: aiBody,
    }));
    const env = makeEnv(ai, kv);

    const result = await recommendMissions(env, "u1", [], [missionA]);
    expect(result.fallback).toBeFalsy();
    expect(result.missionIds).toEqual(["mis_a"]);
  });
});
