---
title: ADR-003 — SSE over WebSockets for live updates
status: Accepted
date: 2026-05-19
deciders: Bosso (@ilGentEAcutoO)
---

# ADR-003: SSE over WebSockets for live updates

## Context

QuestKit pushes real-time updates to the browser whenever server-side state
changes that the UI cares about: a mission completes, a balance changes, a
campaign ends. The shape of these updates is the `SDKUpdate` discriminated
union from `@questkit/types`. The traffic pattern is strictly one-way —
events flow from server to client; the client posts mutations through the
normal `/v1/events` REST endpoint.

There are two natural fits for this pattern on the web platform: WebSockets
and Server-Sent Events. Cloudflare's Workers runtime supports both. On
Workers, WebSockets pair with the **WebSocket Hibernation API** on Durable
Objects, which lets the DO sleep between messages while the connection stays
live. SSE pairs with a long-lived HTTP response carrying an
`EventSource`-compatible stream.

The decision was made early in Phase 2 (TASK-011) and locked by plan
amendment A9.

## Decision

QuestKit broadcasts updates via SSE. The wire protocol is a long-lived
`text/event-stream` HTTP response from `GET /v1/sse/updates` carrying
`event: update\ndata: <SDKUpdate-JSON>\n\n` frames. The endpoint
([workers/api/src/routes/sse.ts](../../workers/api/src/routes/sse.ts)) proxies
the response verbatim from a per-user Durable Object stub. Each user has one
`SSEHub` DO instance addressed by `idFromName(userId)`, so all of a user's
open tabs land on the same DO and one broadcast fans out to all of them.

The `SSEHub` DO ([workers/api/src/durable/sse-hub.ts](../../workers/api/src/durable/sse-hub.ts))
holds a `Set<WritableStreamDefaultWriter<Uint8Array>>` in memory. Every
`/subscribe` call allocates a `TransformStream`, retains the writable half
in the set, and returns the readable half as the response body. Every
`/broadcast` POST writes a framed chunk to each live writer. The initial
chunk is the SSE comment `: connected\n\n` — it flushes response headers so
the client's `onopen` fires immediately and provides a sentinel for tests.

Reconnection follows the EventSource spec: the client (the `@questkit/core`
SDK's reconnect loop, TASK-012) retries with exponential backoff and the
browser's built-in `Last-Event-ID` re-send on reconnect. The server currently
does not persist a per-user event log, so resume is best-effort —
post-Phase-3 missed events are recovered by the SDK's polling fallback, not
by SSE replay.

## Consequences

### Positive

- **Simpler than WebSockets.** No upgrade handshake, no frame protocol, no
  ping/pong heartbeat machinery. The implementation is one DO method plus a
  Hono route that returns the DO's response object as-is.
- **Browser-native reconnect.** `EventSource` handles backoff and re-attach
  automatically. The SDK only owns the reconnect loop for the case where the
  browser gives up (long network outage).
- **HTTP-shaped.** Cloudflare's edge proxy, observability, and request
  metrics all treat the connection as a regular long-lived HTTP request. No
  separate WS dashboard to instrument.
- **CORS is straightforward.** Same `Authorization: Bearer` header pattern as
  every other endpoint (modulo the EventSource header limitation — see
  Negative).
- **One-way semantics fit the architecture.** Mutations flow through the
  normal REST API where they enjoy idempotency, rate limiting, and webhook
  fan-out. Inbound from the SSE channel would have meant building a parallel
  command surface.

### Negative

- **No hibernation during open streams.** The DO must hold the writer set in
  RAM, so it cannot sleep while any subscriber is connected. At Cloudflare's
  current DO pricing, this is roughly $0.15 per active connection per month
  if the user keeps a tab open 24/7. Acceptable at portfolio-stage volume;
  re-evaluate if the SDK is adopted at scale. WebSocket Hibernation would
  have removed this cost but does not apply to SSE (it's WS-only).
- **EventSource cannot send custom headers.** The browser's built-in
  `EventSource` does not allow `Authorization: Bearer` headers. The SDK
  (TASK-012) currently uses an `event-source-polyfill` workaround;
  long-term, an alternative is to pass the JWT as a signed query parameter
  on `?token=` and validate server-side.
- **Best-effort resume.** Without a persisted per-user event log, a missed
  event during a disconnect window is recovered by the SDK's polling
  fallback, not by SSE replay. The `Last-Event-ID` header is accepted but
  currently ignored server-side. Building a persisted event log is a v0.2
  roadmap item.

### Neutral

- **The `SSEHub` DO must retain its in-memory writer set.** This is correctly
  documented as the lifecycle invariant in the DO's JSDoc; new contributors
  must understand that hibernation kills the writers and that's fine
  (clients will reconnect).

## Alternatives considered

### 1. WebSocket Hibernation API on a Durable Object

**Pros**: The DO can sleep between messages, cutting cost roughly in half at
the scale where the cost matters. The Hibernation API is the official 2026
recommendation for any persistent-connection workload on CF.
**Cons**: WS adds genuine complexity for no functional gain on a one-way
channel: frame protocol, ping/pong, manual reconnect logic on the client,
custom backoff. We would also need to handle the browser's `WebSocket`
client which lacks the auto-reconnect EventSource provides.
**Why rejected**: WS-Hibernation pays off when you need bidirectional
messaging or massive concurrent connection counts on a single DO. QuestKit's
SSEHub is per-user — a single connection per tab — so the hibernation win is
small and the WS complexity is large.

### 2. Polling `/v1/updates?since=<timestamp>` every 5 s

**Pros**: Trivially simple. No DO required for delivery. Works on any HTTP
client.
**Cons**: Up to 5 s of latency on every update; visibly worse UX for the
demo. Higher request volume against the rate limiter. Polling makes the
"real-time" claim in the README untrue.
**Why rejected**: A gamification SDK whose reward toasts arrive 5 s after
the user clicks "claim" feels broken. The polling channel survives in the
SDK as a **fallback** when SSE fails entirely (network rules block
EventSource, corporate proxy strips streams).

### 3. HTTP/2 server push

**Pros**: Theoretically standardised. Could push the next mission state on
the back of an unrelated response.
**Cons**: Chrome [removed server-push support in 2022](https://developer.chrome.com/blog/removing-push); other engines followed. The
feature is effectively dead.
**Why rejected**: Browser support is gone. Not a viable transport.

## References

- [Plan amendment A9 — SSEHub via ReadableStream + TransformStream](../../instruction/work/plan.md#3-spec-amendments)
- [Plan §2.5 — `SSE_HUB` binding](../../instruction/work/plan.md#25-bindings-used-by-questkit-worker-api)
- [workers/api/src/durable/sse-hub.ts](../../workers/api/src/durable/sse-hub.ts)
- [workers/api/src/routes/sse.ts](../../workers/api/src/routes/sse.ts)
- [WHATWG HTML — Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [Cloudflare — WebSocket Hibernation API](https://developers.cloudflare.com/durable-objects/api/websockets/)
