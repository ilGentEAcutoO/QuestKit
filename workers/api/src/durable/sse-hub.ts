/**
 * Per-user SSE fanout hub (Durable Object).
 *
 * Why a Durable Object?
 *   - Per-user singleton via `idFromName(userId)` - every SSE connection for
 *     one user lands on the same DO instance, so a broadcast hits every tab
 *     a single user has open at once without cross-shard fan-out.
 *
 * Why NOT WebSocket Hibernation?
 *   - Plan amendment A9 explicitly says: SSEHub is implemented with
 *     ReadableStream + TransformStream per writer. The Hibernation API is
 *     WebSocket-only - it doesn't apply here, and EventSource streams can't
 *     be hibernated anyway (they're long-lived HTTP, no JS message
 *     callbacks to re-attach on wake).
 *
 * Lifecycle:
 *   - On subscribe(): allocate a TransformStream, push its writer into the
 *     in-memory `writers` set, return the readable half as an SSE response.
 *   - On broadcast(): write a framed SSE chunk to every live writer; any
 *     writer that throws on `write` is treated as stale and dropped.
 *   - On client disconnect: the writable's `closed` promise resolves/rejects,
 *     the `.finally(...)` deletes the writer from the set.
 *
 * Hibernation impact:
 *   The `writers` set lives in DO memory; it does NOT survive hibernation.
 *   That's intentional: if the DO sleeps long enough to lose memory state,
 *   any in-flight SSE connections are already dead at the network layer
 *   (CF's edge proxy will have torn them down). Clients reconnect via the
 *   SDK's exponential-backoff loop (TASK-012). This is the documented
 *   behaviour per plan A9.
 *
 * Heartbeat:
 *   Not implemented in v0.1. Clients set a long `retry:` field on
 *   EventSource (TASK-012's SDK) and rely on browser-level keepalive. If the
 *   hub stays idle > 30s, CF's edge proxy may terminate; the SDK's
 *   reconnect-with-backoff fills the gap.
 *
 * The DO class name MUST remain "SSEHub" - wrangler.jsonc references it by
 * exact string in both `migrations[].new_sqlite_classes` and
 * `durable_objects.bindings`.
 *
 * HTTP surface (consumers = routes/sse.ts, routes/missions.ts, routes/events.ts):
 *
 *   GET  /subscribe
 *     200 with `content-type: text/event-stream` - long-lived stream of
 *     `event: update\ndata: <SDKUpdate-JSON>\n\n` chunks. Initial chunk is
 *     a `: connected` SSE comment so the SDK can confirm wireup.
 *
 *   POST /broadcast
 *     Body: a single SDKUpdate as JSON (raw text - we don't re-parse).
 *     200 {"delivered":N} - N is the count of writers that accepted the
 *     write (excludes stale writers dropped on the same call).
 *
 *   404 "not_found" - any other path.
 */
import { DurableObject } from "cloudflare:workers";

export class SSEHub extends DurableObject<Env> {
  /**
   * Live subscriber writers, keyed by identity (Set retains insertion order
   * but we never depend on it). Each entry corresponds to one open SSE
   * connection on this DO. The set is in-memory only - see "Hibernation
   * impact" in the file-level JSDoc.
   */
  private writers = new Set<WritableStreamDefaultWriter<Uint8Array>>();

  /** Reused encoder so we don't allocate per write. */
  private encoder = new TextEncoder();

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/subscribe") {
      return this.subscribe();
    }
    if (req.method === "POST" && url.pathname === "/broadcast") {
      // The caller may abort mid-request (Phase 8 / v0.1.4 TASK-001 wires
      // an `AbortSignal.timeout(2000)` on every routes/* stub.fetch). When
      // that happens, `req.text()` rejects with "Can't read from request
      // stream because client disconnected". Catching here keeps the DO
      // from emitting an unhandled-rejection log line — the caller has
      // already moved on, so a clean 4xx is the right shape.
      let body: string;
      try {
        body = await req.text();
      } catch {
        return new Response("aborted", { status: 499, statusText: "Aborted" });
      }
      return this.broadcast(body);
    }
    return new Response("not_found", { status: 404 });
  }

  /**
   * Open a new SSE stream for a subscriber. Returns the readable half of a
   * TransformStream as the response body; the writable half is retained in
   * `writers` so `broadcast()` can fan out to it.
   *
   * The initial `: connected` is an SSE comment line (lines starting with
   * a colon are ignored by EventSource). It serves two purposes:
   *   1. Forces the HTTP response to flush its headers immediately, so the
   *      client's `onopen` fires without waiting for the first data event.
   *   2. Lets test code read one chunk and assert the connection is wired
   *      end-to-end.
   *
   * Cleanup: the writable's `closed` promise resolves when the client
   * disconnects (or rejects when the connection errors). Either way we
   * remove the writer from the set so a future broadcast doesn't see a
   * dead reference.
   */
  private subscribe(): Response {
    const { readable, writable } = new TransformStream<
      Uint8Array,
      Uint8Array
    >();
    const writer = writable.getWriter();
    this.writers.add(writer);

    // Push the connected sentinel. `void` because we don't want to await
    // here - the write resolves once the byte hits the stream buffer, and
    // we want subscribe() to return the response immediately.
    void writer.write(this.encoder.encode(": connected\n\n"));

    // Detect disconnect. We attach to `writer.closed` (a Promise that
    // settles when the underlying writable closes or errors). When the
    // client tears down the connection, workerd cancels the readable,
    // which propagates to the writer with an error. Catching is required:
    // a rejection on a closed stream is the NORMAL disconnect path and we
    // don't want it surfacing as an unhandled-rejection worker error.
    void writer.closed
      .catch(() => {
        // Closed/aborted is the normal disconnect path; nothing to log.
      })
      .finally(() => {
        this.writers.delete(writer);
      });

    return new Response(readable, {
      headers: {
        // The triad of SSE-required headers. `x-accel-buffering: no` is a
        // belt-and-braces signal to any intermediary proxy (nginx, CF edge
        // in some configs) to NOT buffer the body - SSE is useless without
        // immediate forwarding.
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  /**
   * Per-writer write timeout. A healthy SSE writer should accept a chunk in
   * <1ms — anything in the 1000ms range is a stuck client. Capping here
   * keeps a wedged subscriber from holding the broadcast even though we now
   * run writers in parallel.
   */
  private static readonly WRITER_TIMEOUT_MS = 1000;

  /**
   * Broadcast a serialised SDKUpdate to every live subscriber.
   *
   * SSE framing:  `event: update\ndata: <body>\n\n`
   *
   * The `event:` line lets the SDK's EventSource use a dedicated listener
   * (`source.addEventListener("update", ...)`) instead of the default
   * `onmessage`. The `data:` line is the entire JSON in a single line -
   * we don't pretty-print the SDKUpdate so the body never contains a
   * newline, which would otherwise require multiple `data:` lines per SSE
   * spec.
   *
   * Stale-writer GC: if a `write()` rejects (writer is closed/aborted) OR
   * exceeds the per-writer timeout we record the dead writer and remove
   * it from the set after the loop, so we don't mutate the set
   * mid-iteration.
   *
   * Parallelism + timeout (Phase 8 / v0.1.4 TASK-001):
   *   The previous implementation iterated writers serially with `await
   *   w.write()`, so a SINGLE stalled writer (slow client / backpressured
   *   stream) blocked every healthy writer behind it — and indirectly the
   *   `routes/missions.ts` claim handler that awaited this RPC. We now
   *   write to all writers in parallel via `Promise.allSettled` and cap
   *   each individual write at `WRITER_TIMEOUT_MS` with a `Promise.race`
   *   against a `setTimeout`. The timer is cleared on success so we don't
   *   leak handles in the steady-state hot path.
   *
   *   Stalled writers are GC'd just like erroring writers — they can't
   *   recover within the broadcast cycle, and clients reconnect via the
   *   SDK's backoff loop (TASK-012) if they were briefly slow.
   *
   * @returns 200 with `{delivered: N}` - N excludes stale writers
   *   (timed-out + error-throwing).
   */
  private async broadcast(body: string): Promise<Response> {
    if (this.writers.size === 0) {
      return Response.json({ delivered: 0 });
    }
    const message = this.encoder.encode(`event: update\ndata: ${body}\n\n`);

    /**
     * Per-writer write attempt: race the real `write()` against a 1s
     * timeout. On success: clear the timer (no leaked handle) and report
     * `{ ok: true }`. On error OR timeout: report `{ ok: false, writer }`
     * so the caller can GC the dead writer.
     *
     * We capture the writer in the result rather than mutating the
     * `writers` set inline so a single iteration over `Promise.allSettled`
     * results does the GC in one shot — matching the original "don't
     * mutate the set mid-iteration" contract.
     */
    const attempts = Array.from(this.writers).map(
      async (
        w,
      ): Promise<
        | { ok: true }
        | { ok: false; writer: WritableStreamDefaultWriter<Uint8Array> }
      > => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            w.write(message),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("writer_timeout")),
                SSEHub.WRITER_TIMEOUT_MS,
              );
            }),
          ]);
          return { ok: true };
        } catch {
          return { ok: false, writer: w };
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      },
    );

    const results = await Promise.allSettled(attempts);
    let delivered = 0;
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.ok) {
          delivered++;
        } else {
          this.writers.delete(r.value.writer);
        }
      }
      // r.status === "rejected" cannot happen here — the inner async
      // function never throws; it always resolves with { ok, writer? }.
    }
    return Response.json({ delivered });
  }
}
