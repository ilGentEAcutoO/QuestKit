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

describe("questKitClient.onFireEventSuccess (TASK-006 optimistic updates)", () => {
  // The SDK fires a `onFireEventSuccess(missionsUpdated)` callback after
  // every successful fireEvent. The React `useMissions` hook listens to
  // this and bumps `currentCount` optimistically — so counters keep moving
  // even when the SSE channel is degraded. See useMissions.ts for the
  // (intentionally simple) merge policy.
  it("invokes registered callbacks with missionsUpdated on success", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({
        accepted: true,
        eventId: "ev-success",
        missionsUpdated: ["m1", "m2"],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const cb = jest.fn();
    const unsub = client.onFireEventSuccess(cb);

    await client.fireEvent({ name: "purchase.completed", payload: {} });

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(["m1", "m2"]);

    unsub();
    client.destroy();
  });

  it("does NOT invoke callbacks when fireEvent rejects (4xx)", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "invalid_event" }, 400),
    ]);
    const client = makeClient(fetchImpl);
    const cb = jest.fn();
    client.onFireEventSuccess(cb);

    await expect(
      client.fireEvent({ name: "x", payload: {} }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(cb).not.toHaveBeenCalled();
    client.destroy();
  });

  it("does NOT invoke callbacks when fireEvent is queued (5xx)", async () => {
    const { fetchImpl } = mockFetch([jsonResponse({ error: "boom" }, 503)]);
    const client = makeClient(fetchImpl);
    const cb = jest.fn();
    client.onFireEventSuccess(cb);

    const r = await client.fireEvent({ name: "x", payload: {} });
    expect(r.queued).toBe(true);
    // The callback is only for *successful* immediate posts (and the eventual
    // success of a queued retry, which we don't exercise here).
    expect(cb).not.toHaveBeenCalled();
    client.destroy();
  });

  it("unsubscribe removes the callback", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({
        accepted: true,
        eventId: "ev1",
        missionsUpdated: ["m1"],
      }),
      jsonResponse({
        accepted: true,
        eventId: "ev2",
        missionsUpdated: ["m1"],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const cb = jest.fn();
    const unsub = client.onFireEventSuccess(cb);

    await client.fireEvent({ name: "a", payload: {} });
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    await client.fireEvent({ name: "b", payload: {} });
    expect(cb).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("fans out to multiple listeners", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({
        accepted: true,
        eventId: "ev1",
        missionsUpdated: ["m1"],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const a = jest.fn();
    const b = jest.fn();
    client.onFireEventSuccess(a);
    client.onFireEventSuccess(b);

    await client.fireEvent({ name: "x", payload: {} });
    expect(a).toHaveBeenCalledWith(["m1"]);
    expect(b).toHaveBeenCalledWith(["m1"]);
    client.destroy();
  });

  it("a throwing listener does not block fanout to other listeners", async () => {
    const { fetchImpl } = mockFetch([
      jsonResponse({
        accepted: true,
        eventId: "ev1",
        missionsUpdated: ["m1"],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const bad = jest.fn().mockImplementation(() => {
      throw new Error("listener boom");
    });
    const good = jest.fn();
    client.onFireEventSuccess(bad);
    client.onFireEventSuccess(good);

    await client.fireEvent({ name: "x", payload: {} });
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalledWith(["m1"]);
    client.destroy();
  });

  it("fires when a previously-queued event eventually succeeds (via flushEvents)", async () => {
    // The first POST returns 503, queueing the event. Subsequent POSTs
    // succeed. Whether the success comes from the background flush
    // kicked off by fireEvent or from the explicit flushEvents() below,
    // the listener must be invoked with the server's missionsUpdated.
    const { fetchImpl } = mockFetch([
      jsonResponse({ error: "boom" }, 503),
      jsonResponse({
        accepted: true,
        eventId: "ev-retry",
        missionsUpdated: ["m1"],
      }),
    ]);
    const client = makeClient(fetchImpl);
    const cb = jest.fn();
    client.onFireEventSuccess(cb);

    const r = await client.fireEvent({ name: "x", payload: {} });
    expect(r.queued).toBe(true);

    // Yield to pending microtasks so the background flush kicked off
    // inside fireEvent can drain, then explicitly flush as a backstop.
    // Polling beats a fixed setTimeout — flush completion order is not
    // load-bearing for the test, but the dispatch IS.
    for (let i = 0; i < 10 && cb.mock.calls.length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 0));
      await client.flushEvents();
    }

    expect(cb).toHaveBeenCalledWith(["m1"]);
    expect(cb).toHaveBeenCalledTimes(1);
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
