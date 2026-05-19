---
sidebar_position: 7
title: GET /v1/sse/updates
description: Long-lived Server-Sent Events stream for live updates.
---

# GET `/v1/sse/updates`

Long-lived Server-Sent Events stream that broadcasts every state change relevant to the authenticated user — mission progress, completion, claims, balance changes, recommendation refreshes.

## Request

```bash
curl -N https://api.questkit.jairukchan.com/v1/sse/updates \
  -H "Authorization: Bearer <JWT>"
```

The `-N` flag tells curl not to buffer — required for SSE.

## Response

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"mission.progress","data":{"userId":"usr_demo_123","missionId":"daily-streak","status":"active","progress":0.57,"currentCount":4,"targetCount":7,"updatedAt":1716100200000}}

data: {"type":"mission.completed","data":{"userId":"usr_demo_123","missionId":"daily-streak","status":"completed","progress":1,"currentCount":7,"targetCount":7,"updatedAt":1716100300000}}

data: {"type":"reward.granted","data":{"userId":"usr_demo_123","missionId":"daily-streak","reward":{"kind":"currency","currency":"gold","amount":100}}}

data: {"type":"balance.changed","data":{"userId":"usr_demo_123","currency":"gold","amount":1200,"updatedAt":1716100300000}}

data: {"type":"recommendation","data":{"userId":"usr_demo_123","missionIds":["spring-buyer"],"reason":"You're a frequent buyer this week."}}
```

Each `data:` line is a JSON-encoded `SDKUpdate`.

## SDKUpdate variants

```ts
type SDKUpdate =
  | { type: "mission.progress"; data: MissionProgress }
  | { type: "mission.completed"; data: MissionProgress }
  | { type: "balance.changed"; data: Balance }
  | {
      type: "reward.granted";
      data: { userId: string; reward: Reward; missionId: string };
    }
  | {
      type: "recommendation";
      data: { userId: string; missionIds: string[]; reason: string };
    };
```

## Implementation notes

- One Durable Object instance per user (`SSEHub`). All of a user's open tabs subscribe to the same DO; mutations broadcast once and fan out.
- The stream stays open until the client disconnects. The DO's `TransformStream` cleans up its writer reference automatically on close.
- The browser-native `EventSource` can't send `Authorization` headers. The SDK either uses a polyfill that supports headers, or passes the JWT via a query param fallback. Document this in your SDK consumer code.

## Reconnect strategy

The SDK reconnects with exponential backoff (base 1s, max 30s, with jitter) and gives up after 5 consecutive failures, falling back to polling. Manual reconnect is supported by closing the stream and opening a new one.

## Errors

| HTTP | Reason                  |
| ---- | ----------------------- |
| 401  | Missing or invalid JWT. |
