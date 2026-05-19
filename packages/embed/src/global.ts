/**
 * `window.QuestKit` imperative API.
 *
 * Builds the host-facing object that lets developers fire events, claim
 * rewards, query balances, and mount/unmount widgets at runtime without
 * touching React directly. Every method wraps its inner call in try/catch
 * so a host-side bug or transient SDK failure never bubbles out as a
 * page-breaking exception — we just `console.warn` and resolve.
 *
 * Subscriptions (`on` / `off`) take an SDKUpdate listener and route to
 * the SDK's SSE/polling subscribe. We keep a Map<listener, unsubscribe>
 * so `off` can find the underlying tear-down handle.
 */
import type { QuestKitClient } from "@questkit/core";
import type { Balance, SDKUpdate } from "@questkit/types";

import { type MountHandle, mountWidget } from "./mount";
import { scanWidgets } from "./scan";

export interface QuestKitGlobal {
  fireEvent: (name: string, payload?: Record<string, unknown>) => Promise<void>;
  claim: (missionId: string) => Promise<void>;
  getBalance: (currency: string) => Promise<Balance | null>;
  mount: (root?: ParentNode) => void;
  unmount: (el?: HTMLElement) => void;
  on: (listener: (update: SDKUpdate) => void) => void;
  off: (listener: (update: SDKUpdate) => void) => void;
  /** Visible for tests + the playground — do not document publicly. */
  _client: QuestKitClient;
}

declare global {
  // eslint-disable-next-line vars-on-top
  var QuestKit: QuestKitGlobal | undefined;
  interface Window {
    QuestKit?: QuestKitGlobal;
  }
}

/**
 * Build the global API surface. The caller (`index.ts`) is responsible for
 * assigning the result to `window.QuestKit` after first scan + mount.
 */
export function buildGlobal(client: QuestKitClient): QuestKitGlobal {
  const handles = new Map<HTMLElement, MountHandle>();
  const subs = new Map<(u: SDKUpdate) => void, () => void>();

  return {
    _client: client,

    async fireEvent(
      name: string,
      payload: Record<string, unknown> = {},
    ): Promise<void> {
      try {
        await client.fireEvent({ name, payload });
      } catch (err) {
        console.warn("[QuestKit] fireEvent error:", err);
      }
    },

    async claim(missionId: string): Promise<void> {
      try {
        await client.claimMission(missionId);
      } catch (err) {
        console.warn("[QuestKit] claim error:", err);
      }
    },

    async getBalance(currency: string): Promise<Balance | null> {
      try {
        return await client.getBalance(currency);
      } catch (err) {
        console.warn("[QuestKit] getBalance error:", err);
        return null;
      }
    },

    /**
     * Re-scan the DOM (or a subtree) and mount widgets that aren't already
     * mounted. Idempotent — re-mounting the same element replaces the
     * previous render.
     */
    mount(root: ParentNode = document): void {
      try {
        const descriptors = scanWidgets(root);
        for (const d of descriptors) {
          const existing = handles.get(d.el);
          if (existing !== undefined) existing.unmount();
          const handle = mountWidget(d, client);
          if (handle !== null) handles.set(d.el, handle);
        }
      } catch (err) {
        console.warn("[QuestKit] mount error:", err);
      }
    },

    /**
     * Tear down a specific element's widget (no arg → unmount all).
     */
    unmount(el?: HTMLElement): void {
      try {
        if (el === undefined) {
          for (const handle of handles.values()) handle.unmount();
          handles.clear();
          return;
        }
        const handle = handles.get(el);
        if (handle === undefined) return;
        handle.unmount();
        handles.delete(el);
      } catch (err) {
        console.warn("[QuestKit] unmount error:", err);
      }
    },

    on(listener: (update: SDKUpdate) => void): void {
      try {
        if (subs.has(listener)) return;
        const unsubscribe = client.subscribe(listener);
        subs.set(listener, unsubscribe);
      } catch (err) {
        console.warn("[QuestKit] on() error:", err);
      }
    },

    off(listener: (update: SDKUpdate) => void): void {
      try {
        const unsubscribe = subs.get(listener);
        if (unsubscribe === undefined) return;
        unsubscribe();
        subs.delete(listener);
      } catch (err) {
        console.warn("[QuestKit] off() error:", err);
      }
    },
  };
}
