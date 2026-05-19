/**
 * SSEClient tests — fetch is mocked to return controlled ReadableStreams,
 * so we can deterministically test chunking, multi-message buffers,
 * reconnect, and give-up paths.
 */
import type { SDKUpdate } from "@questkit/types";
import { SSEClient } from "../src/sse";

/**
 * Build a Response whose body is a ReadableStream wrapping an array of
 * pre-encoded UTF-8 chunks. Useful for emulating chunked SSE delivery.
 */
function streamFromChunks(chunks: Uint8Array[]): Response {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        const chunk = chunks[i++];
        if (chunk !== undefined) controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

// Small helper to wait for the SSE drain microtasks to settle after connect().
function nextTick(): Promise<void> {
  return new Promise((res) => setTimeout(res, 0));
}

describe("sSEClient — happy path", () => {
  it("dispatches a single update message", async () => {
    const updates: SDKUpdate[] = [];
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        streamFromChunks([
          enc(
            'event: update\ndata: {"type":"balance.changed","data":{"userId":"u","currency":"coin","amount":10,"updatedAt":1}}\n\n',
          ),
        ]),
      );
    const client = new SSEClient({
      baseUrl: "https://api.example",
      getToken: () => "tok",
      onUpdate: (u) => updates.push(u),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.connect();
    await nextTick();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      type: "balance.changed",
      data: { currency: "coin", amount: 10 },
    });
    client.disconnect();
  });

  it("sends Authorization Bearer header with the resolved token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(streamFromChunks([]));
    const client = new SSEClient({
      baseUrl: "https://api.example",
      getToken: async () => "tok-123",
      onUpdate: () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnectAttempts: 0,
    });
    await client.connect();
    expect(fetchImpl).toHaveBeenCalled();
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example/v1/sse/updates");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok-123",
    );
    client.disconnect();
  });

  it("dispatches multiple messages from a single response", async () => {
    const updates: SDKUpdate[] = [];
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        streamFromChunks([
          enc(
            'event: update\ndata: {"type":"balance.changed","data":{"userId":"u","currency":"coin","amount":1,"updatedAt":1}}\n\n',
          ),
          enc(
            'event: update\ndata: {"type":"balance.changed","data":{"userId":"u","currency":"coin","amount":2,"updatedAt":2}}\n\n',
          ),
        ]),
      );
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: (u) => updates.push(u),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnectAttempts: 0,
    });
    await client.connect();
    await nextTick();
    expect(updates).toHaveLength(2);
    client.disconnect();
  });

  it("handles a message split across two chunks (mid-data boundary)", async () => {
    const updates: SDKUpdate[] = [];
    // Split a single data: line across two chunks. Boundary is between "gra" and "nted".
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        streamFromChunks([
          enc('event: update\ndata: {"type":"reward.gra'),
          enc(
            'nted","data":{"userId":"u","reward":{"kind":"badge","badgeId":"b1"},"missionId":"m1"}}\n\n',
          ),
        ]),
      );
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: (u) => updates.push(u),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnectAttempts: 0,
    });
    await client.connect();
    await nextTick();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      type: "reward.granted",
      data: { missionId: "m1" },
    });
    client.disconnect();
  });

  it("ignores non-update events and comment lines", async () => {
    const updates: SDKUpdate[] = [];
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        streamFromChunks([
          enc(": connected\n\n"),
          enc("event: heartbeat\ndata: ping\n\n"),
          enc(
            'event: update\ndata: {"type":"balance.changed","data":{"userId":"u","currency":"coin","amount":7,"updatedAt":1}}\n\n',
          ),
        ]),
      );
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: (u) => updates.push(u),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnectAttempts: 0,
    });
    await client.connect();
    await nextTick();
    expect(updates).toHaveLength(1);
    client.disconnect();
  });
});

describe("sSEClient — error paths", () => {
  it("calls onError when data: contains malformed JSON, stream continues", async () => {
    const errors: Error[] = [];
    const updates: SDKUpdate[] = [];
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        streamFromChunks([
          enc("event: update\ndata: {not json\n\n"),
          enc(
            'event: update\ndata: {"type":"balance.changed","data":{"userId":"u","currency":"coin","amount":5,"updatedAt":1}}\n\n',
          ),
        ]),
      );
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: (u) => updates.push(u),
      onError: (e) => errors.push(e),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnectAttempts: 0,
    });
    await client.connect();
    await nextTick();
    expect(errors.length).toBeGreaterThan(0);
    expect(updates).toHaveLength(1);
    client.disconnect();
  });

  it("reconnects with exponential backoff on transient failure", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 502, statusText: "bad gateway" }),
      )
      .mockResolvedValue(streamFromChunks([]));

    const errors: Error[] = [];
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: () => undefined,
      onError: (e) => errors.push(e),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseBackoffMs: 5,
      maxBackoffMs: 50,
      maxReconnectAttempts: 3,
    });
    await client.connect();
    // first attempt failed; wait long enough for the backoff timer
    await new Promise((res) => setTimeout(res, 30));
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    client.disconnect();
  });

  it("invokes onGiveUp after maxReconnectAttempts", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("offline"));
    const giveUp = jest.fn();
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseBackoffMs: 1,
      maxBackoffMs: 4,
      maxReconnectAttempts: 2,
      onGiveUp: giveUp,
    });
    await client.connect();
    // Allow all retries to complete; cap waits in test
    await new Promise((res) => setTimeout(res, 50));
    expect(giveUp).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(client.attemptCount()).toBeGreaterThan(2);
    client.disconnect();
  });

  it("disconnect() during reconnect cancels future attempts", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(streamFromChunks([]));
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: () => undefined,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      baseBackoffMs: 30,
      maxReconnectAttempts: 3,
    });
    await client.connect();
    // Immediately disconnect during backoff
    client.disconnect();
    await new Promise((res) => setTimeout(res, 50));
    // Only one call (the initial failure).
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects when getToken throws and surfaces it via onError", async () => {
    const errors: Error[] = [];
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: async () => {
        throw new Error("no token");
      },
      onUpdate: () => undefined,
      onError: (e) => errors.push(e),
      fetchImpl: jest.fn() as unknown as typeof fetch,
      maxReconnectAttempts: 0,
      baseBackoffMs: 1,
    });
    await client.connect();
    await nextTick();
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]?.message).toContain("no token");
    client.disconnect();
  });

  it("reports connect status via isConnected()", async () => {
    let connectResolved = false;
    let releaseStream!: () => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        releaseStream = () => controller.close();
      },
    });
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(new Response(stream, { status: 200 }));
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: () => undefined,
      onConnect: () => {
        connectResolved = true;
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnectAttempts: 0,
    });
    await client.connect();
    expect(connectResolved).toBe(true);
    expect(client.isConnected()).toBe(true);
    releaseStream();
    client.disconnect();
  });
});

describe("sSEClient — CRLF support", () => {
  it("accepts CRLF-formatted SSE streams", async () => {
    const updates: SDKUpdate[] = [];
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        streamFromChunks([
          enc(
            'event: update\r\ndata: {"type":"balance.changed","data":{"userId":"u","currency":"coin","amount":42,"updatedAt":1}}\r\n\r\n',
          ),
        ]),
      );
    const client = new SSEClient({
      baseUrl: "https://x",
      getToken: () => "t",
      onUpdate: (u) => updates.push(u),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnectAttempts: 0,
    });
    await client.connect();
    await nextTick();
    expect(updates).toHaveLength(1);
    client.disconnect();
  });
});
