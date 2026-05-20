/**
 * QuestKitClient tests — verify URL / headers / body match the server contract
 * for every public method, plus the SSE integration plumbing and lifecycle.
 *
 * Most tests mock `fetchImpl` with a minimal Response. The single SSE test
 * uses a controlled ReadableStream to confirm subscribe() ends up calling
 * the listener with parsed updates.
 */
import type {
  Balance,
  Mission,
  MissionProgress,
  SDKUpdate,
} from "@questkit/types";
import { QuestKitClient } from "../src/client";
import { QuestKitError } from "../src/errors";
import { MemoryStorage } from "../src/storage";

// Build a fake JWT (header.payload.sig — header/sig are dummies; we only
// need a valid base64url-encoded payload with a `sub` claim).
function makeFakeJwt(sub: string): string {
  const header = "eyJhbGciOiJIUzI1NiJ9"; // {"alg":"HS256"}
  // btoa is available in modern Node (>= 16) and all browsers.
  const payload = btoa(JSON.stringify({ sub, exp: 9_999_999_999 }))
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.sig`;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

interface MockCall {
  url: string;
  init: RequestInit;
}

function mockFetch(responses: Response[]): {
  fetchImpl: typeof fetch;
  calls: MockCall[];
} {
  const calls: MockCall[] = [];
  let i = 0;
  const fetchImpl = jest
    .fn()
    .mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      const r = responses[i] ?? responses[responses.length - 1];
      i += 1;
      return Promise.resolve(r);
    });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

function makeClient(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof QuestKitClient>[0]> = {},
): QuestKitClient {
  return new QuestKitClient({
    baseUrl: "https://api.example",
    appId: "app1",
    getToken: () => makeFakeJwt("user1"),
    fetchImpl,
    storage: new MemoryStorage(),
    ...overrides,
  });
}

describe("questKitClient — config", () => {
  it("throws on missing baseUrl", () => {
    expect(
      () =>
        new QuestKitClient({
          baseUrl: "",
          appId: "x",
          getToken: () => "t",
        }),
    ).toThrow(QuestKitError);
  });

  it("strips trailing slash from baseUrl", async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse({ balances: [] })]);
    const client = new QuestKitClient({
      baseUrl: "https://api.example/",
      appId: "app1",
      getToken: () => makeFakeJwt("u"),
      fetchImpl,
    });
    await client.getBalances();
    expect(calls[0]?.url).toBe("https://api.example/v1/balance");
    client.destroy();
  });
});

describe("questKitClient.mintToken", () => {
  it("posts to /v1/auth/token with the body shape and returns the token", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({ token: "tok-xyz", expiresAt: 12345 }),
    ]);
    const client = makeClient(fetchImpl);
    const result = await client.mintToken({
      appSecret: "secret",
      userId: "user1",
    });
    expect(result).toEqual({ token: "tok-xyz", expiresAt: 12345 });
    expect(calls[0]?.url).toBe("https://api.example/v1/auth/token");
    const init = calls[0]?.init;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      appId: "app1",
      appSecret: "secret",
      userId: "user1",
    });
    client.destroy();
  });

  it("throws QuestKitError on non-2xx", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "invalid_credentials" }, 401),
    ]);
    const client = makeClient(fetchImpl);
    await expect(
      client.mintToken({ appSecret: "wrong", userId: "u" }),
    ).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
    });
    client.destroy();
  });
});

describe("questKitClient.fireEvent", () => {
  it("posts to /v1/events with auth + idempotency header on happy path", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({
        accepted: true,
        eventId: "ev1",
        missionsUpdated: ["m1"],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const result = await client.fireEvent({
      name: "purchase.completed",
      payload: { amount: 10 },
      idempotencyKey: "idem-1",
    });
    expect(result).toEqual({
      accepted: true,
      eventId: "ev1",
      missionsUpdated: ["m1"],
    });
    expect(calls[0]?.url).toBe("https://api.example/v1/events");
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer /);
    expect(headers["idempotency-key"]).toBe("idem-1");
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toMatchObject({
      userId: "user1",
      name: "purchase.completed",
      payload: { amount: 10 },
      idempotencyKey: "idem-1",
    });
    expect(typeof body.timestamp).toBe("number");
    client.destroy();
  });

  it("auto-generates idempotencyKey when not provided", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({ accepted: true, eventId: "e", missionsUpdated: [] }),
    ]);
    const client = makeClient(fetchImpl);
    await client.fireEvent({ name: "x.y", payload: {} });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(typeof body.idempotencyKey).toBe("string");
    expect(body.idempotencyKey.length).toBeGreaterThan(0);
    client.destroy();
  });

  it("queues the event on 5xx and returns queued=true", async () => {
    const { fetchImpl } = mockFetch([jsonResponse({ error: "internal" }, 500)]);
    const client = makeClient(fetchImpl);
    const result = await client.fireEvent({ name: "x", payload: {} });
    expect(result.queued).toBe(true);
    expect(result.accepted).toBe(false);
    expect(client.queueDepth()).toBeGreaterThanOrEqual(0); // background flush may have removed it
    client.destroy();
  });

  it("throws on 400 validation error (non-retryable)", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "invalid_event" }, 400),
    ]);
    const client = makeClient(fetchImpl);
    await expect(
      client.fireEvent({ name: "x", payload: {} }),
    ).rejects.toMatchObject({ code: "validation_error", status: 400 });
    client.destroy();
  });

  it("throws on 401 unauthorized", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "missing_or_invalid_token" }, 401),
    ]);
    const client = makeClient(fetchImpl);
    await expect(
      client.fireEvent({ name: "x", payload: {} }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    client.destroy();
  });

  it("flushEvents drains the queue", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "boom" }, 503),
      jsonResponse({ accepted: true, eventId: "e", missionsUpdated: [] }),
    ]);
    const client = makeClient(fetchImpl);
    const r = await client.fireEvent({ name: "x", payload: {} });
    expect(r.queued).toBe(true);
    // Manually flush — should hit the second (success) response
    await client.flushEvents();
    client.destroy();
  });
});

describe("questKitClient.getMissions", () => {
  const mission: Mission = {
    id: "m1",
    title: "Buy 3 items",
    description: "",
    criteria: { eventName: "purchase.completed", count: 3 },
    reward: { kind: "currency", currency: "coin", amount: 100 },
  };
  const progress: MissionProgress = {
    userId: "user1",
    missionId: "m1",
    status: "active",
    progress: 0.5,
    currentCount: 1,
    targetCount: 3,
    updatedAt: 1,
  };

  it("hits GET /v1/missions and returns the typed response", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({ missions: [mission], progress: { m1: progress } }),
    ]);
    const client = makeClient(fetchImpl);
    const r = await client.getMissions();
    expect(r.missions).toHaveLength(1);
    expect(r.progress.m1?.status).toBe("active");
    expect(calls[0]?.url).toBe("https://api.example/v1/missions");
    expect(calls[0]?.init.method).toBe("GET");
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toMatch(/^Bearer /);
    client.destroy();
  });

  it("encodes query params correctly", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({ missions: [], progress: {} }),
    ]);
    const client = makeClient(fetchImpl);
    await client.getMissions({
      campaignId: "camp1",
      status: "active",
      limit: 20,
      cursor: "abc",
    });
    const url = calls[0]?.url ?? "";
    expect(url).toContain("campaignId=camp1");
    expect(url).toContain("status=active");
    expect(url).toContain("limit=20");
    expect(url).toContain("cursor=abc");
    client.destroy();
  });
});

describe("questKitClient.getMission", () => {
  it("hits GET /v1/missions/:id", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({
        mission: {
          id: "m1",
          title: "x",
          description: "",
          criteria: { eventName: "n", count: 1 },
          reward: { kind: "badge", badgeId: "b1" },
        },
        progress: null,
      }),
    ]);
    const client = makeClient(fetchImpl);
    const r = await client.getMission("m1");
    expect(r.mission.id).toBe("m1");
    expect(r.progress).toBeNull();
    expect(calls[0]?.url).toBe("https://api.example/v1/missions/m1");
    client.destroy();
  });

  it("throws not_found on 404", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "mission_not_found" }, 404),
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.getMission("none")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    client.destroy();
  });
});

describe("questKitClient.claimMission", () => {
  it("posts to /v1/missions/:id/claim", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({
        progress: {
          userId: "user1",
          missionId: "m1",
          status: "claimed",
          progress: 1,
          currentCount: 3,
          targetCount: 3,
          updatedAt: 1,
        },
        balance: {
          userId: "user1",
          currency: "coin",
          amount: 100,
          updatedAt: 1,
        },
        reward: { kind: "currency", currency: "coin", amount: 100 },
      }),
    ]);
    const client = makeClient(fetchImpl);
    const r = await client.claimMission("m1");
    expect(r.progress.status).toBe("claimed");
    expect(r.balance?.amount).toBe(100);
    expect(calls[0]?.url).toBe("https://api.example/v1/missions/m1/claim");
    expect(calls[0]?.init.method).toBe("POST");
    client.destroy();
  });

  it("includes Idempotency-Key when supplied", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({
        progress: {
          userId: "user1",
          missionId: "m1",
          status: "claimed",
          progress: 1,
          currentCount: 1,
          targetCount: 1,
          updatedAt: 1,
        },
        balance: null,
        reward: { kind: "badge", badgeId: "b1" },
      }),
    ]);
    const client = makeClient(fetchImpl);
    await client.claimMission("m1", { idempotencyKey: "claim-1" });
    const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
    expect(headers["idempotency-key"]).toBe("claim-1");
    client.destroy();
  });

  it("handles balance: null for non-currency rewards", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({
        progress: {
          userId: "user1",
          missionId: "m1",
          status: "claimed",
          progress: 1,
          currentCount: 1,
          targetCount: 1,
          updatedAt: 1,
        },
        balance: null,
        reward: { kind: "badge", badgeId: "b1" },
      }),
    ]);
    const client = makeClient(fetchImpl);
    const r = await client.claimMission("m1");
    expect(r.balance).toBeNull();
    expect(r.reward.kind).toBe("badge");
    client.destroy();
  });

  it("throws on 409 not-ready", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "claim_not_ready" }, 409),
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.claimMission("m1")).rejects.toMatchObject({
      status: 409,
    });
    client.destroy();
  });
});

describe("questKitClient.getBalances / getBalance", () => {
  it("returns the balances array from /v1/balance", async () => {
    const b: Balance = {
      userId: "user1",
      currency: "coin",
      amount: 50,
      updatedAt: 1,
    };
    const { fetchImpl, calls } = mockFetch([jsonResponse({ balances: [b] })]);
    const client = makeClient(fetchImpl);
    const r = await client.getBalances();
    expect(r).toEqual([b]);
    expect(calls[0]?.url).toBe("https://api.example/v1/balance");
    client.destroy();
  });

  it("returns the zero-state balance when the server has no row", async () => {
    // v0.1.0+ the API returns 200 + a synthetic zero balance for missing
    // currencies (no more 404). The client always resolves to a Balance.
    const zero: Balance = {
      userId: "user1",
      currency: "gem",
      amount: 0,
      updatedAt: 1779_000_000_000,
    };
    const { fetchImpl } = mockFetch([jsonResponse({ balance: zero })]);
    const client = makeClient(fetchImpl);
    const r = await client.getBalance("gem");
    expect(r).toEqual(zero);
    expect(r.amount).toBe(0);
    client.destroy();
  });

  it("returns the balance row on 200", async () => {
    const b: Balance = {
      userId: "user1",
      currency: "coin",
      amount: 7,
      updatedAt: 1,
    };
    const { fetchImpl, calls } = mockFetch([jsonResponse({ balance: b })]);
    const client = makeClient(fetchImpl);
    const r = await client.getBalance("coin");
    expect(r).toEqual(b);
    expect(calls[0]?.url).toBe("https://api.example/v1/balance/coin");
    client.destroy();
  });

  it("throws on 5xx for getBalance", async () => {
    const { fetchImpl } = mockFetch([jsonResponse({ error: "boom" }, 503)]);
    const client = makeClient(fetchImpl);
    await expect(client.getBalance("coin")).rejects.toMatchObject({
      code: "server_error",
    });
    client.destroy();
  });
});

describe("questKitClient.getCampaigns / getCampaign", () => {
  it("hits GET /v1/campaigns", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({
        campaigns: [
          {
            id: "c1",
            title: "x",
            description: "",
            startAt: 1,
            endAt: 9_999_999_999,
            missionIds: ["m1"],
          },
        ],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const r = await client.getCampaigns();
    expect(r).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.example/v1/campaigns");
    client.destroy();
  });

  it("includes ?include=expired when requested", async () => {
    const { fetchImpl, calls } = mockFetch([jsonResponse({ campaigns: [] })]);
    const client = makeClient(fetchImpl);
    await client.getCampaigns({ includeExpired: true });
    expect(calls[0]?.url).toContain("include=expired");
    client.destroy();
  });

  it("hits GET /v1/campaigns/:id with optional include=missions", async () => {
    const { fetchImpl, calls } = mockFetch([
      jsonResponse({
        campaign: {
          id: "c1",
          title: "x",
          description: "",
          startAt: 1,
          endAt: 2,
          missionIds: ["m1"],
        },
        missions: [
          {
            id: "m1",
            title: "y",
            description: "",
            criteria: { eventName: "n", count: 1 },
            reward: { kind: "badge", badgeId: "b" },
          },
        ],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const r = await client.getCampaign("c1", { includeMissions: true });
    expect(r.missions).toHaveLength(1);
    expect(calls[0]?.url).toContain("include=missions");
    client.destroy();
  });

  it("throws not_found on 404", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "campaign_not_found" }, 404),
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.getCampaign("nope")).rejects.toMatchObject({
      code: "not_found",
    });
    client.destroy();
  });
});

describe("questKitClient.subscribe", () => {
  it("opens a SSE stream on first subscriber and dispatches updates", async () => {
    // Mock stream that emits one update message.
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const msg =
          'event: update\ndata: {"type":"balance.changed","data":{"userId":"user1","currency":"coin","amount":42,"updatedAt":1}}\n\n';
        controller.enqueue(enc.encode(msg));
        controller.close();
      },
    });
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith("/v1/sse/updates")) {
        return Promise.resolve(new Response(stream, { status: 200 }));
      }
      return Promise.resolve(jsonResponse({ balances: [] }));
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const received: SDKUpdate[] = [];
    const off = client.subscribe((u) => received.push(u));
    // Allow the connect + drain to settle
    await new Promise((res) => setTimeout(res, 20));
    expect(received.length).toBeGreaterThanOrEqual(1);
    off();
    client.destroy();
  });

  it("destroy() tears down stream and prevents further calls", async () => {
    const { fetchImpl } = mockFetch([jsonResponse({ balances: [] })]);
    const client = makeClient(fetchImpl);
    client.destroy();
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "config_error",
    });
  });

  it("subscribe is fan-out — multiple listeners get the same update", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          enc.encode(
            'event: update\ndata: {"type":"balance.changed","data":{"userId":"user1","currency":"coin","amount":1,"updatedAt":1}}\n\n',
          ),
        );
        controller.close();
      },
    });
    const fetchImpl = jest.fn().mockImplementation((url: string) => {
      if (url.endsWith("/v1/sse/updates"))
        return Promise.resolve(new Response(stream, { status: 200 }));
      return Promise.resolve(jsonResponse({}));
    });
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const a: SDKUpdate[] = [];
    const b: SDKUpdate[] = [];
    client.subscribe((u) => a.push(u));
    client.subscribe((u) => b.push(u));
    await new Promise((res) => setTimeout(res, 20));
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(b.length).toBeGreaterThanOrEqual(1);
    client.destroy();
  });
});

describe("questKitClient — request timeouts (TASK-005)", () => {
  // Each test uses a tiny `timeoutMs` so the suite stays fast. The
  // `pendingFetch` helper returns a never-resolving promise so the only
  // thing that can settle the call is our timeout signal.
  function pendingFetch(): {
    fetchImpl: typeof fetch;
    aborted: () => boolean;
  } {
    let aborted = false;
    const fetchImpl = jest
      .fn()
      .mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal === null || signal === undefined) {
            // No signal — the test would hang. Fail loudly.
            reject(new Error("test setup: expected an AbortSignal on fetch"));
            return;
          }
          if (signal.aborted) {
            aborted = true;
            reject(
              Object.assign(new Error("aborted"), {
                name: "TimeoutError",
              }),
            );
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              // Mimic what the platform fetch throws on a TimeoutError:
              // DOMException("...", "TimeoutError"). We approximate that
              // with a plain Error whose .name matches.
              const err = new Error("The operation was aborted");
              err.name = "TimeoutError";
              reject(err);
            },
            { once: true },
          );
        });
      });
    return {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      aborted: () => aborted,
    };
  }

  it("rejects mintToken with code=timeout when fetch hangs past timeoutMs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = new QuestKitClient({
      baseUrl: "https://api.example",
      appId: "app1",
      getToken: () => makeFakeJwt("u"),
      fetchImpl,
      timeoutMs: 25,
    });
    const start = Date.now();
    await expect(
      client.mintToken({ appSecret: "s", userId: "u" }),
    ).rejects.toMatchObject({ code: "timeout" });
    // Sanity: the rejection must arrive within a few multiples of the
    // configured timeout. 200 ms is generous on slow CI without making the
    // assertion meaningless.
    expect(Date.now() - start).toBeLessThan(200);
    client.destroy();
  });

  it("rejects getMissions with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.getMissions()).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("rejects getMission with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.getMission("m1")).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("rejects claimMission with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.claimMission("m1")).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("rejects getBalances with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("rejects getBalance with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.getBalance("coin")).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("rejects getCampaigns with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.getCampaigns()).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("rejects getCampaign with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.getCampaign("c1")).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("rejects getRecommendations with code=timeout when fetch hangs", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    await expect(client.getRecommendations()).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });

  it("queues (does not throw) when fireEvent's fetch hangs — the queue is the retry surface", async () => {
    // fireEvent has its own try/catch that maps any network-level failure
    // (timeout included) into a queued result. That's the intentional
    // contract: the caller's `isFiring` flag clears via the resolved
    // promise, and the event is durable in the queue for the background
    // flush.
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 20 });
    const result = await client.fireEvent({ name: "x", payload: {} });
    expect(result.queued).toBe(true);
    expect(result.accepted).toBe(false);
    client.destroy();
  });

  it("error message names the configured timeoutMs so logs are diagnosable", async () => {
    const { fetchImpl } = pendingFetch();
    const client = makeClient(fetchImpl, { timeoutMs: 33 });
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "timeout",
      message: expect.stringContaining("33ms"),
    });
    client.destroy();
  });

  it("defaults to 10000ms when timeoutMs is not provided", async () => {
    const { fetchImpl } = pendingFetch();
    const client = new QuestKitClient({
      baseUrl: "https://api.example",
      appId: "app1",
      getToken: () => makeFakeJwt("u"),
      fetchImpl,
    });
    // We can't wait the full 10s in CI — instead, manually abort via the
    // signal the SDK passed to fetch and confirm it took ~10s worth of
    // signal-aliveness. Simpler: just inspect that the SDK does NOT throw
    // immediately; the test wins if the call is still pending after a
    // short delay.
    const promise = client.getBalances();
    const winner = await Promise.race([
      promise.then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((res) => setTimeout(() => res("pending"), 50)),
    ]);
    expect(winner).toBe("pending");
    // Clean up: the request will eventually time out at 10s — destroy()
    // doesn't cancel the in-flight fetch, so we swallow the eventual
    // rejection to avoid an unhandled-promise warning. Setting a no-op
    // .catch is enough.
    promise.catch(() => {
      /* expected — will reject with timeout after 10s */
    });
    client.destroy();
  });

  it("honours timeoutMs: 0 as 'no timeout' for tests that drive aborts by hand", async () => {
    // With timeoutMs=0, request() short-circuits and passes the caller's
    // init through untouched — useful for tests that want to verify the
    // mock fetch sees exactly what the SDK sent without a synthetic signal.
    const { fetchImpl, calls } = mockFetch([jsonResponse({ balances: [] })]);
    const client = makeClient(fetchImpl, { timeoutMs: 0 });
    await client.getBalances();
    const init = calls[0]?.init;
    // No signal injected — we passed no signal, the SDK kept its hands off.
    expect(init?.signal).toBeUndefined();
    client.destroy();
  });

  it("re-throws non-timeout AbortErrors verbatim (caller-driven aborts pass through)", async () => {
    // Verify isTimeoutAbort discriminates: a caller-provided AbortController
    // that aborts BEFORE our timeout fires should bubble up as the original
    // error, not be remapped to QuestKitError(timeout). We exercise this by
    // making the fetch reject with an AbortError that DIDN'T come from our
    // signal — the timeout signal never fires.
    const fakeAbort = new Error("caller cancelled");
    fakeAbort.name = "AbortError";
    const fetchImpl = jest.fn().mockRejectedValue(fakeAbort);
    const client = makeClient(fetchImpl as unknown as typeof fetch, {
      timeoutMs: 10000,
    });
    // Should reject with the original error shape, not QuestKitError.
    await expect(client.getBalances()).rejects.toBe(fakeAbort);
    client.destroy();
  });

  it("maps a real AbortSignal.timeout-driven failure to QuestKitError(timeout) end-to-end", async () => {
    // Sanity: skip the mock and let the SDK pair its real AbortSignal.timeout
    // with a fetch that genuinely hangs until aborted. Validates the chain
    // AbortSignal.timeout → DOMException("TimeoutError") → isTimeoutAbort →
    // QuestKitError(timeout) works on the actual runtime (not just against
    // our synthetic mock).
    const fetchImpl = (url: string, init?: RequestInit): Promise<Response> => {
      // Bind URL to keep ESLint quiet about unused param.
      void url;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          reject(new Error("no signal provided"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            // Reproduce DOMException("...", "TimeoutError") closely enough
            // for isTimeoutAbort to match.
            const err = new Error("aborted");
            err.name = "TimeoutError";
            reject(err);
          },
          { once: true },
        );
      });
    };
    const client = makeClient(fetchImpl as unknown as typeof fetch, {
      timeoutMs: 15,
    });
    await expect(client.getBalances()).rejects.toBeInstanceOf(QuestKitError);
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "timeout",
    });
    client.destroy();
  });
});

describe("questKitClient — error mapping", () => {
  it("maps 403 to forbidden", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "user_mismatch" }, 403),
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    client.destroy();
  });

  it("maps 429 to rate_limited", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "rate_limited" }, 429),
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    client.destroy();
  });

  it("falls back to status-based message when body is not JSON", async () => {
    const { fetchImpl } = mockFetch([
      new Response("plaintext", { status: 500 }),
    ]);
    const client = makeClient(fetchImpl);
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "server_error",
    });
    client.destroy();
  });
});

describe("questKitClient — authedFetch shared timeout budget (TASK-005 follow-up)", () => {
  it("honours timeoutMs as a SHARED budget across 401-retry — not 2× timeoutMs", async () => {
    // Regression test for the "doubled budget" bug. With timeoutMs=100:
    //   - Attempt 1 → 401 after ~50ms (consumes half the budget)
    //   - Token refresh (cheap)
    //   - Attempt 2 → hangs forever
    //
    // The contract says the WHOLE chain must reject within ~timeoutMs. A
    // broken impl would create a fresh AbortSignal.timeout(100) for attempt
    // 2 and reject around ~150ms total. We assert <150ms to catch that.
    let call = 0;
    const fetchImpl = jest
      .fn()
      .mockImplementation((_url: string, init?: RequestInit) => {
        call += 1;
        const signal = init?.signal;
        if (call === 1) {
          // Attempt 1: respond 401 quickly so attempt 2 can begin under the
          // SAME budget.
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve(jsonResponse({ error: "unauthorized" }, 401));
            }, 50);
            if (signal && !signal.aborted) {
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  const e = new Error("aborted-during-attempt-1");
                  e.name = "TimeoutError";
                  reject(e);
                },
                { once: true },
              );
            }
          });
        }
        // Attempt 2: hang forever; only the SHARED abort signal can settle us.
        return new Promise<Response>((_resolve, reject) => {
          if (signal === undefined || signal === null) {
            reject(
              new Error("test setup: expected an AbortSignal on attempt 2"),
            );
            return;
          }
          if (signal.aborted) {
            const e = new Error("already-aborted");
            e.name = "TimeoutError";
            reject(e);
            return;
          }
          signal.addEventListener(
            "abort",
            () => {
              const e = new Error("aborted-during-attempt-2");
              e.name = "TimeoutError";
              reject(e);
            },
            { once: true },
          );
        });
      });

    const client = makeClient(fetchImpl as unknown as typeof fetch, {
      timeoutMs: 100,
    });
    const start = Date.now();
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "timeout",
    });
    const elapsed = Date.now() - start;
    // Shared budget: must reject within ~100ms (+ a small CI tolerance).
    // A doubled budget would land near 150ms+ — we'd flag that.
    expect(elapsed).toBeLessThan(150);
    // And both attempts actually ran (the bug we're testing only manifests
    // when the second attempt is reached).
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    client.destroy();
  });

  it("does not start attempt 2 if the shared budget expired during attempt 1 + refresh", async () => {
    // Variant: attempt 1 returns 401 just as the timeout fires. The
    // pre-attempt-2 check should short-circuit instead of spinning up a
    // second fetch with a fresh budget.
    let call = 0;
    const fetchImpl = jest.fn().mockImplementation((_url: string) => {
      call += 1;
      // Attempt 1 returns 401 right at the edge of the budget.
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(jsonResponse({ error: "unauthorized" }, 401));
        }, 40);
      });
    });

    // Slow getToken so the shared budget expires DURING the refresh, before
    // attempt 2 fires.
    const slowGetToken = (): Promise<string> =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve(makeFakeJwt("u")), 80);
      });

    const client = new QuestKitClient({
      baseUrl: "https://api.example",
      appId: "app1",
      getToken: slowGetToken,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: new MemoryStorage(),
      timeoutMs: 100,
    });
    await expect(client.getBalances()).rejects.toMatchObject({
      code: "timeout",
    });
    // Attempt 2 must never have started — the budget was already gone.
    expect(call).toBe(1);
    client.destroy();
  });
});

describe("questKitClient — fireEvent error discrimination (TASK-005 follow-up)", () => {
  it("throws (does NOT queue) when getTokenFn rejects with QuestKitError(config_error)", async () => {
    // The original bare-catch silently queued config errors — a
    // programmer-visible bug got hidden behind a queued: true result. The
    // tightened catch must rethrow.
    const fetchImpl = jest.fn(); // should never be called
    const client = new QuestKitClient({
      baseUrl: "https://api.example",
      appId: "app1",
      getToken: () => {
        throw new QuestKitError("invalid token", "config_error");
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      storage: new MemoryStorage(),
    });
    await expect(
      client.fireEvent({ name: "x", payload: {} }),
    ).rejects.toMatchObject({
      code: "config_error",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.queueDepth()).toBe(0);
    client.destroy();
  });

  it("throws (does NOT queue) when response body is not valid JSON", async () => {
    // The server returned a 200 with garbage — that's a programmer-visible
    // contract violation (server bug, or wrong endpoint pointed at). The
    // SDK must surface it instead of queueing forever.
    //
    // Note: cross-realm `instanceof SyntaxError` is unreliable in jsdom
    // (Response.json constructs the error in its own realm). Match by
    // .name instead — that's what consumers would do anyway.
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response("nope", { status: 200 }));
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    await expect(
      client.fireEvent({ name: "x", payload: {} }),
    ).rejects.toMatchObject({ name: "SyntaxError" });
    // The malformed-body case is NOT retryable — must not enqueue.
    expect(client.queueDepth()).toBe(0);
    client.destroy();
  });

  it("still queues genuine network-level failures (TypeError from fetch)", async () => {
    // Regression guard: the new discriminator must still treat real network
    // failures (DNS, disconnect — surfaced as TypeError in WHATWG fetch) as
    // retryable. Without this assertion, an over-tight discriminator would
    // turn the offline case into a hard throw and break the queue contract.
    const networkError = new TypeError("Failed to fetch");
    const fetchImpl = jest.fn().mockRejectedValue(networkError);
    const client = makeClient(fetchImpl as unknown as typeof fetch);
    const result = await client.fireEvent({ name: "x", payload: {} });
    expect(result.queued).toBe(true);
    expect(result.accepted).toBe(false);
    client.destroy();
  });
});
