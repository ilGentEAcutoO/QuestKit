import { QuestKitClient } from "@questkit/core";
/**
 * DemoClientProvider — bootstraps a single QuestKitClient for the demo,
 * wraps the tree in <QuestKitProvider>, and renders children only once
 * the initial JWT mint has resolved.
 *
 * The client uses `getToken: async () => (await mintToken(userId)).token`,
 * which means every authed request transparently re-checks the cached
 * token and refreshes when within REFRESH_THRESHOLD_MS of expiry.
 */
import { QuestKitProvider } from "@questkit/react";
import {
  type ReactElement,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { mintToken } from "./auth";
import { resolveDemoUserId } from "./demoUserId";

const DEMO_APP_ID = "demo";
const DEMO_API_BASE = "https://api.questkit.jairukchan.com";

// `resolveDemoUserId` is the per-browser unique-id resolver added in v0.1.10
// (TASK-011 / F2 fix). The full behaviour lives in `./demoUserId.ts` — see
// that file's JSDoc for the precedence rules (SSR → `?user=` → LS hit →
// fresh mint + LS write → private-mode fallback). Re-exported for any
// consumer that wants to call it directly (e.g. DevTools panel).
export { resolveDemoUserId };
const DEMO_USER_ID = resolveDemoUserId();

interface BootstrapState {
  kind: "idle" | "loading" | "ready" | "error";
  error?: string;
}

export interface DemoClientProviderProps {
  /**
   * Optional override (mostly for storybook/tests). When provided the
   * provider uses this id instead of `demo_user_42`. Changing this prop
   * at runtime triggers a fresh mint + client rebuild.
   */
  userId?: string;
  children: ReactNode;
}

export function DemoClientProvider({
  userId = DEMO_USER_ID,
  children,
}: DemoClientProviderProps): ReactElement {
  const [state, setState] = useState<BootstrapState>({ kind: "idle" });

  // Mint once per userId before instantiating the client. We use a state
  // flag so React doesn't render the QuestKitProvider with a half-built
  // client.
  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    mintToken(userId)
      .then(() => {
        if (cancelled) return;
        setState({ kind: "ready" });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setState({ kind: "error", error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Memoize the client across renders so children don't see a fresh
  // QuestKitClient on every parent re-render (which would tear down SSE).
  const config = useMemo(
    () => ({
      appId: DEMO_APP_ID,
      baseUrl: DEMO_API_BASE,
      getToken: async (): Promise<string> => {
        const { token } = await mintToken(userId);
        return token;
      },
    }),
    [userId],
  );

  if (state.kind === "error") {
    return (
      <div
        role="alert"
        className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div
          aria-hidden="true"
          className="grid h-12 w-12 place-items-center rounded-full bg-red-100 text-2xl text-red-700"
        >
          !
        </div>
        <h1 className="text-xl font-semibold">Could not start the demo</h1>
        <p className="max-w-md text-sm text-[color:var(--color-demo-muted)]">
          {state.error ?? "Unknown error"}
        </p>
        <p className="max-w-md text-xs text-[color:var(--color-demo-muted)]">
          The /api/token proxy needs an APP_SECRET set on questkit-worker-demo.
          See apps/demo/.dev.vars.example.
        </p>
      </div>
    );
  }

  if (state.kind !== "ready") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex min-h-dvh items-center justify-center"
      >
        <span className="sr-only">Loading QuestKit demo</span>
        <span
          aria-hidden="true"
          className="inline-block h-10 w-10 animate-spin rounded-full border-4 border-[color:var(--color-demo-border)] border-t-[color:var(--color-demo-accent)]"
        />
      </div>
    );
  }

  // We construct the client lazily through QuestKitProvider's config prop —
  // it owns lifecycle (destroy on unmount) and avoids re-instantiation on
  // identity-stable parents.
  return <QuestKitProvider config={config}>{children}</QuestKitProvider>;
}

/** Bare metadata helpers exposed for the DevTools panel. */
export const demoMeta = {
  userId: DEMO_USER_ID,
  appId: DEMO_APP_ID,
  apiBase: DEMO_API_BASE,
};

/** Construct a one-off client without the provider — used by panels that
 *  need to read state outside the React tree (e.g. EventLog SSE handler
 *  before subscribing). Currently unused but exported for completeness. */
export function buildClient(userId: string = DEMO_USER_ID): QuestKitClient {
  return new QuestKitClient({
    appId: DEMO_APP_ID,
    baseUrl: DEMO_API_BASE,
    getToken: async (): Promise<string> => {
      const { token } = await mintToken(userId);
      return token;
    },
  });
}
