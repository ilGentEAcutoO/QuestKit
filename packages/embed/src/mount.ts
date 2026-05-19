/**
 * Mount a single widget descriptor into a Shadow DOM.
 *
 * Why Shadow DOM:
 *   - Host CSS can't reach into our widgets and break them (Tailwind utility
 *     bleed, layout resets, font-family overrides, etc).
 *   - Our CSS can't leak back out and break the host.
 *   - The widget keeps its own scope for IDs, classes, etc.
 *
 * Tradeoff: we have to inject the QuestKit stylesheet into each shadow
 * root because Shadow DOM blocks document-level CSS. We embed the
 * stylesheet text as a string constant produced at build time (see
 * STYLES_CSS below).
 *
 * Each mount call returns an `unmount` handle so the imperative
 * `window.QuestKit.unmount(el)` and SDK lifecycle can clean up properly.
 */
import type { QuestKitClient } from "@questkit/core";
import type { WidgetDescriptor } from "./scan";
import {
  CampaignBanner,
  CoinBalance,
  MissionCard,
  MissionList,
  ProgressBar,
  QuestKitProvider,
  RecommendedMissions,
  RewardClaimToastHost,
  ScratchCard,
  SpinWheel,
} from "@questkit/react";
import { type ComponentType, createElement } from "react";

import { createRoot, type Root } from "react-dom/client";
import { STYLES_CSS } from "./styles";

/**
 * Whitelist of components the embed can render by name. New widgets need
 * an explicit entry here — we don't expose arbitrary imports to host
 * scripts, both for safety and because we want a stable embed surface.
 *
 * The component type is intentionally loose (`ComponentType<any>`) because
 * each component's props differ; we coerce attribute values into the
 * shape each component expects at the call site below.
 */

const WIDGETS: Record<string, ComponentType<any>> = {
  MissionList,
  MissionCard,
  CoinBalance,
  CampaignBanner,
  ProgressBar,
  RecommendedMissions,
  SpinWheel,
  ScratchCard,
  RewardClaimToastHost,
};

export interface MountHandle {
  /** Tear down React, drop the Shadow DOM contents. Idempotent. */
  unmount: () => void;
  /** The shadow root in case the host wants to peek (tests, mainly). */
  shadowRoot: ShadowRoot;
}

/**
 * Render a single widget descriptor inside its element via Shadow DOM +
 * React 18 root.
 *
 * Errors during render are caught and logged via `console.warn` so a bad
 * prop or a missing widget can't crash the host page.
 */
export function mountWidget(
  descriptor: WidgetDescriptor,
  client: QuestKitClient,
): MountHandle | null {
  const Component = WIDGETS[descriptor.widget];
  if (Component === undefined) {
    console.warn(
      `[QuestKit] unknown widget "${descriptor.widget}" — skipping mount.`,
    );
    return null;
  }

  // Attach (or reuse) an open Shadow DOM. Open mode keeps inspection
  // possible from devtools without exposing internals to host JS lookups
  // beyond what's already visible.
  let shadow: ShadowRoot;
  try {
    shadow =
      descriptor.el.shadowRoot ?? descriptor.el.attachShadow({ mode: "open" });
  } catch (err) {
    console.warn(
      `[QuestKit] failed to attach Shadow DOM for "${descriptor.widget}":`,
      err,
    );
    return null;
  }

  // Reset the shadow root in case a previous mount left state.
  shadow.textContent = "";

  // Inject the QuestKit stylesheet. Adopted stylesheets would be tidier
  // but the host might not support them on older browsers — a plain
  // <style> tag is portable and avoids a runtime feature-detect branch.
  const styleEl = document.createElement("style");
  styleEl.textContent = STYLES_CSS;
  shadow.appendChild(styleEl);

  // React expects a real Element to render into; create one inside the
  // shadow so the React tree lives alongside the <style> tag.
  const mountPoint = document.createElement("div");
  mountPoint.className = "qk-embed-root";
  shadow.appendChild(mountPoint);

  let root: Root;
  try {
    root = createRoot(mountPoint);
  } catch (err) {
    console.warn(
      `[QuestKit] createRoot failed for "${descriptor.widget}":`,
      err,
    );
    return null;
  }

  try {
    const childEl = createElement(Component, descriptor.props);
    root.render(createElement(QuestKitProvider, { client, children: childEl }));
  } catch (err) {
    console.warn(`[QuestKit] render failed for "${descriptor.widget}":`, err);
    root.unmount();
    return null;
  }

  let unmounted = false;
  return {
    unmount: (): void => {
      if (unmounted) return;
      unmounted = true;
      try {
        root.unmount();
      } catch (err) {
        console.warn(
          `[QuestKit] unmount error for "${descriptor.widget}":`,
          err,
        );
      }
    },
    shadowRoot: shadow,
  };
}
