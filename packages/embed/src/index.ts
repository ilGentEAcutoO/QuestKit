/**
 * @questkit/embed — IIFE entry.
 *
 * Bundled via tsdown into `dist/questkit.iife.js`. The bundle wraps
 * everything in an IIFE assigned to `window.QuestKit` (configured via
 * `globalName` in tsdown.config.ts), so a host page only needs:
 *
 *   <script src="https://cdn.../questkit.iife.js"
 *           data-questkit-app-id="..."
 *           data-questkit-user-id="..."
 *           data-questkit-base-url="https://api.questkit..."></script>
 *   <div data-questkit="MissionList"></div>
 *
 * Boot flow:
 *
 *   1. Capture `document.currentScript` at module init (it is null by the
 *      time `DOMContentLoaded` fires).
 *   2. Read `data-questkit-*` attrs off that script to build a
 *      `QuestKitClient`.
 *   3. On DOMContentLoaded, scan for `[data-questkit]` elements and
 *      mount each widget.
 *   4. Expose the imperative `window.QuestKit` global so the host can
 *      `fireEvent`, `claim`, `mount` further widgets, etc.
 *
 * Any error in steps 2–4 is `console.warn`-ed; we never throw out of the
 * IIFE because that would interrupt the host page's other scripts.
 */
import { QuestKitClient } from "@questkit/core";

import { buildGlobal } from "./global";
import { mountWidget } from "./mount";
import { readScriptConfig, scanWidgets } from "./scan";

// Capture the script tag NOW — `document.currentScript` is non-null only
// during synchronous top-level execution.
const currentScript =
  typeof document !== "undefined" &&
  document.currentScript instanceof HTMLScriptElement
    ? document.currentScript
    : null;

function boot(): void {
  try {
    const config = readScriptConfig(currentScript);
    if (config === null) {
      console.warn(
        "[QuestKit] missing required script attrs " +
          "(data-questkit-app-id, data-questkit-user-id, data-questkit-base-url) " +
          "— embed will not auto-init.",
      );
      return;
    }

    // The embed doesn't have access to JWT minting from the browser
    // (appSecret stays on the server). The `userId` attribute is a
    // pre-minted token reference OR the userId itself when the host
    // page injects the token via meta tag — we accept a `getToken`
    // resolver in advanced setups, but for v0.1 the simplest contract
    // is: pass a userId, the embed assumes a pre-minted token is
    // attached via a `<meta name="questkit-token">` tag in the host.
    const tokenMeta =
      typeof document !== "undefined"
        ? document.querySelector<HTMLMetaElement>('meta[name="questkit-token"]')
        : null;
    const staticToken = tokenMeta?.getAttribute("content") ?? "";

    const client = new QuestKitClient({
      baseUrl: config.baseUrl,
      appId: config.appId,
      getToken: (): string => staticToken,
    });

    const global = buildGlobal(client);
    if (typeof window !== "undefined") {
      // Avoid trampling an existing global (e.g. duplicate <script> tags)
      // — second loads share the first client to keep one SSE stream.
      if (window.QuestKit === undefined) {
        window.QuestKit = global;
      }
    }

    // Initial scan + mount once the DOM is ready.
    const runScan = (): void => {
      try {
        const descriptors = scanWidgets(document);
        for (const d of descriptors) {
          mountWidget(d, client);
        }
      } catch (err) {
        console.warn("[QuestKit] initial scan failed:", err);
      }
    };

    if (typeof document !== "undefined" && document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", runScan, { once: true });
    } else {
      runScan();
    }
  } catch (err) {
    console.warn("[QuestKit] boot failed:", err);
  }
}

boot();
