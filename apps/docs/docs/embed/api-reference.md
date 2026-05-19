---
sidebar_position: 3
title: window.QuestKit API
description: The imperative global API the embed installs.
---

# `window.QuestKit` API

After the embed boots, it installs a single global: `window.QuestKit`. Every method wraps its inner SDK call in try/catch — a transient SDK failure or a host bug never bubbles out as a page-breaking exception. Failures are logged with `console.warn`.

## Type

```ts
interface QuestKitGlobal {
  fireEvent: (name: string, payload?: Record<string, unknown>) => Promise<void>;
  claim: (missionId: string) => Promise<void>;
  getBalance: (currency: string) => Promise<Balance | null>;
  mount: (root?: ParentNode) => void;
  unmount: (el?: HTMLElement) => void;
  on: (listener: (update: SDKUpdate) => void) => void;
  off: (listener: (update: SDKUpdate) => void) => void;
}
```

## `fireEvent(name, payload?)`

Fire an event from anywhere in the host page.

```html
<button id="buy">Buy</button>
<script>
  document.getElementById("buy").addEventListener("click", () => {
    window.QuestKit.fireEvent("purchase.completed", { sku: "boots-01" });
  });
</script>
```

Resolves (without throwing) regardless of success. Inspect the network tab or the SSE feed to confirm delivery.

## `claim(missionId)`

Imperatively claim a completed mission.

```js
await window.QuestKit.claim("daily-streak");
```

## `getBalance(currency)`

Returns the current balance for a currency, or `null` if no row exists.

```js
const gold = await window.QuestKit.getBalance("gold");
if (gold !== null) console.log(gold.amount);
```

## `mount(root?)`

Re-scan the DOM (or a sub-tree) and mount any widgets that aren't already mounted. Use this after dynamically injecting new mount points (single-page app navigation, async content loading).

```js
const container = document.getElementById("dashboard");
container.insertAdjacentHTML(
  "beforeend",
  '<div data-questkit="CoinBalance" data-questkit-prop-currency="gem"></div>',
);
window.QuestKit.mount(container);
```

Idempotent — re-mounting the same element replaces the previous render.

## `unmount(el?)`

Tear down a single widget, or all widgets when called without an argument.

```js
window.QuestKit.unmount(document.getElementById("my-mission-list"));
// or:
window.QuestKit.unmount(); // tear down everything
```

## `on(listener)` / `off(listener)`

Subscribe to the live `SDKUpdate` stream. The listener receives every event the SDK emits via SSE (or the polling fallback).

```js
function onUpdate(update) {
  if (update.type === "reward.granted") {
    alert(`You got a reward: ${JSON.stringify(update.data.reward)}`);
  }
}

window.QuestKit.on(onUpdate);
// ...later:
window.QuestKit.off(onUpdate);
```

`SDKUpdate` is one of:

- `mission.progress` — progress changed
- `mission.completed` — mission moved to `completed` status
- `reward.granted` — `claim` mutation succeeded
- `balance.changed` — currency balance changed
- `recommendation` — AI recommendations refreshed for this user

## Initialization gotchas

- `data-questkit-app-id`, `-user-id`, and `-base-url` are required on the `<script>` tag — missing any one and the embed `console.warn`s and skips auto-init. `window.QuestKit` will not be installed.
- A second `<script src=".../questkit.iife.js">` on the same page does **not** replace the first global — duplicate loads share the first client to keep a single SSE stream.
- `mount(root)` will rescan a subtree but will not re-mount an element that already has an active widget — call `unmount(el)` first if you want a fresh render.
