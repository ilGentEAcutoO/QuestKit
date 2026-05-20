/**
 * SSEClient — Server-Sent Events stream consumer.
 *
 * Why not `EventSource`? The browser's built-in EventSource cannot send
 * `Authorization` headers (W3C spec restriction), and our server only
 * accepts `Bearer` tokens. So we roll our own SSE parser on top of
 * `fetch` + `ReadableStream`, which works identically in modern browsers
 * (~99% of our target) and Node 18+.
 *
 * Wire format (per RFC + TASK-011 contract):
 *
 *   event: update\n
 *   data: <JSON SDKUpdate>\n
 *   \n                              # blank line = message terminator
 *
 *   : connected\n                   # comment line (`:` prefix) — ignored
 *   \n
 *
 * Reconnect strategy: exp-backoff up to `maxReconnectAttempts`, then
 * `onGiveUp()` is called (the QuestKitClient wires that to a polling
 * fallback so the user keeps getting updates, just less promptly).
 *
 * Lifecycle:
 *   - connect()       — opens the stream; resolves once the fetch returns
 *                       a 2xx response (subsequent stream errors trigger
 *                       reconnect, not promise rejection).
 *   - disconnect()    — aborts the fetch; cancels any pending reconnect.
 */
import type { SDKUpdate } from "@questkit/types";

export interface SSEOpts {
  baseUrl: string;
  getToken: () => Promise<string> | string;
  onUpdate: (update: SDKUpdate) => void;
  onError?: (err: Error) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  /** Max consecutive reconnect attempts before invoking `onGiveUp`. */
  maxReconnectAttempts?: number;
  baseBackoffMs?: number;
  /** Capped maximum backoff delay regardless of attempt count. */
  maxBackoffMs?: number;
  /**
   * Called when reconnect attempts are exhausted. The QuestKitClient wires
   * this to start a `PollingClient` so the user experience degrades
   * gracefully.
   */
  onGiveUp?: () => void;
  /**
   * Optional fetch implementation override (for tests; default is global fetch).
   */
  fetchImpl?: typeof fetch;
}

const DEFAULT_MAX_RECONNECT = 5;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;

export class SSEClient {
  private readonly opts: SSEOpts;
  private readonly fetchImpl: typeof fetch;
  private readonly maxReconnect: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  /** Current AbortController for the in-flight fetch (null when idle). */
  private controller: AbortController | null = null;
  /** Timer for scheduled reconnect (null when none scheduled). */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Set when the consumer has called disconnect() — suppresses reconnect. */
  private stopped = false;
  /** Number of consecutive failed connect attempts. */
  private attempts = 0;
  /** Visible to tests via getter — current connection state. */
  private connected = false;

  constructor(opts: SSEOpts) {
    this.opts = opts;
    // Bind to globalThis for the same reason as client.ts + polling.ts: calling
    // `this.fetchImpl(...)` as a method invokes the browser's native fetch with
    // `this === SSEClient`, which throws "TypeError: Illegal invocation". The
    // SSE handler catches it as a stream error → 5 reconnect retries all fail
    // → polling fallback kicks in but the SSE network request never even
    // appears in DevTools, so the demo's "live updates" promise was broken
    // until the poll interval caught up. This was the third instance of the
    // same unbound-native-API bug pattern.
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.maxReconnect = opts.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT;
    this.baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
  }

  /**
   * Open the SSE stream and start consuming. Returns once the initial
   * connect has resolved (or thrown). Network blips after that point are
   * handled by the internal reconnect loop, not propagated to the caller.
   */
  async connect(): Promise<void> {
    this.stopped = false;
    await this.openStream();
  }

  /** Abort the in-flight fetch and cancel any pending reconnect. */
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.controller !== null) {
      this.controller.abort();
      this.controller = null;
    }
    if (this.connected) {
      this.connected = false;
      this.opts.onDisconnect?.();
    }
  }

  /** True if the stream is currently receiving. */
  isConnected(): boolean {
    return this.connected;
  }

  /** Number of failed reconnect attempts since the last success. */
  attemptCount(): number {
    return this.attempts;
  }

  // --- internals ---

  private async openStream(): Promise<void> {
    if (this.stopped) return;
    const controller = new AbortController();
    this.controller = controller;

    let token: string;
    try {
      token = await this.opts.getToken();
    } catch (err) {
      // Token resolution failed — treat as a connect failure and back off.
      this.handleStreamError(
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.opts.baseUrl}/v1/sse/updates`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
      });
    } catch (err) {
      // Fetch itself failed (offline, DNS, aborted).
      if (this.stopped) return;
      this.handleStreamError(
        err instanceof Error ? err : new Error(String(err)),
      );
      return;
    }

    if (!response.ok) {
      this.handleStreamError(
        new Error(`SSE connect failed with status ${response.status}`),
      );
      return;
    }
    if (response.body === null) {
      this.handleStreamError(new Error("SSE response had no body"));
      return;
    }

    // We're live.
    this.attempts = 0;
    this.connected = true;
    this.opts.onConnect?.();

    // Drain the stream. Awaited inline — but we don't `await` this from
    // `connect()` because we want connect() to resolve as soon as the
    // headers arrive (matches EventSource semantics). The drain runs as
    // a background promise.
    this.drain(response.body).catch((err: unknown) => {
      // Defensive — drain errors are routed through handleStreamError, but
      // any rethrown defect should not become an unhandled rejection.
      this.handleStreamError(
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }

  /**
   * Read the stream chunk-by-chunk, decode UTF-8, split on the SSE message
   * separator (\n\n), and dispatch each well-formed `event: update` message.
   */
  private async drain(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined) {
          buffer += decoder.decode(value, { stream: true });
        }
        // SSE messages are separated by \n\n (or \r\n\r\n).
        // We process every complete message in the buffer; the tail
        // (which may be a partial message) stays in buffer for the next loop.
        // We accept both \n\n and \r\n\r\n separators.
        for (;;) {
          const sepIdx = findMessageBoundary(buffer);
          if (sepIdx === -1) break;
          const rawMessage = buffer.slice(0, sepIdx);
          // The boundary is 2 chars for \n\n, 4 for \r\n\r\n. We compute the
          // post-boundary index based on which separator matched.
          const afterIdx = buffer[sepIdx] === "\r" ? sepIdx + 4 : sepIdx + 2;
          buffer = buffer.slice(afterIdx);
          this.dispatchMessage(rawMessage);
        }
      }
      // Stream end — flush any trailing decoded bytes (no-op for our format).
      const tail = decoder.decode();
      if (tail.length > 0) buffer += tail;
      // Server cleanly closed the stream — reconnect.
      if (!this.stopped) {
        this.handleStreamError(new Error("SSE stream closed by server"));
      }
    } catch (err) {
      // AbortError from disconnect() is expected — treat as a graceful close.
      if (this.stopped) {
        // Final cleanup; no further action.
        return;
      }
      this.handleStreamError(
        err instanceof Error ? err : new Error(String(err)),
      );
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Already released or stream torn down — ignore.
      }
    }
  }

  /**
   * Parse a single SSE message (the text between two `\n\n` separators).
   *
   * SSE messages are line-oriented; each line is of the form `field: value`.
   * We care about two fields:
   *   - `event` — the event name; we only act on `event: update`.
   *   - `data`  — the JSON body. Multi-line data is concatenated with `\n`.
   *
   * Comments (`: ...`) are ignored. `id` and `retry` fields are also ignored
   * for v0.1 — we don't use Last-Event-ID resume.
   */
  private dispatchMessage(raw: string): void {
    let eventName = "";
    let data = "";
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      if (line === "") continue;
      if (line.startsWith(":")) continue; // comment
      const colonIdx = line.indexOf(":");
      // Lines with no colon are "field with empty value" per spec — we
      // don't care about any such fields.
      if (colonIdx === -1) continue;
      const field = line.slice(0, colonIdx);
      // SSE spec: if the value starts with a single space, it's stripped.
      let value = line.slice(colonIdx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") eventName = value;
      else if (field === "data") {
        // Concatenate multi-line data values with \n.
        data = data.length === 0 ? value : `${data}\n${value}`;
      }
    }
    if (eventName !== "update") {
      // Not the update event we care about — ignore (e.g. heartbeat events
      // or future channel separations).
      return;
    }
    if (data.length === 0) return;
    try {
      const parsed: unknown = JSON.parse(data);
      // We trust the server contract — the SSEHub broadcasts pre-serialised
      // SDKUpdate values. A type assertion is appropriate here because
      // validating the discriminated union at runtime would re-implement
      // 30 LOC for marginal benefit.
      this.opts.onUpdate(parsed as SDKUpdate);
    } catch (err) {
      this.opts.onError?.(
        err instanceof Error ? err : new Error("SSE JSON parse failed"),
      );
      // Stream continues — one bad message shouldn't terminate the connection.
    }
  }

  /**
   * Called on any stream-level failure (fetch threw, server closed, status
   * non-2xx). Bumps the attempt counter and schedules a reconnect, or
   * gives up after `maxReconnectAttempts`.
   */
  private handleStreamError(err: Error): void {
    if (this.stopped) return;
    if (this.connected) {
      this.connected = false;
      this.opts.onDisconnect?.();
    }
    this.opts.onError?.(err);
    this.attempts += 1;
    if (this.attempts > this.maxReconnect) {
      this.opts.onGiveUp?.();
      return;
    }
    const delay = Math.min(
      this.baseBackoffMs * 2 ** (this.attempts - 1),
      this.maxBackoffMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // openStream is async but we don't need to await — it routes errors
      // back through handleStreamError on its own.
      void this.openStream();
    }, delay);
  }
}

/**
 * Find the index of the first SSE-message boundary (either `\n\n` or
 * `\r\n\r\n`) in `s`. Returns -1 if no complete message yet.
 *
 * The returned index points at the FIRST `\n` (or `\r`) of the boundary;
 * the caller is responsible for advancing past the boundary length.
 */
function findMessageBoundary(s: string): number {
  const lf = s.indexOf("\n\n");
  const crlf = s.indexOf("\r\n\r\n");
  if (lf === -1 && crlf === -1) return -1;
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}
