import { QuestKitClient, type QuestKitConfig } from "@questkit/core";

/**
 * QuestKitProvider — the React context that owns one QuestKitClient instance
 * for the lifetime of the host tree. Hooks (TASK-015) read from this context.
 *
 * Construction is gated on the config being non-null because tests / SSR
 * scenarios sometimes want to render the tree before a token is available.
 * In that case the client is `null` and `useQuestKit()` throws — hooks must
 * guard with `if (client === null) return loading-state`.
 */
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

interface QuestKitContextValue {
  client: QuestKitClient;
}

const QuestKitContext = createContext<QuestKitContextValue | null>(null);

export interface QuestKitProviderProps {
  /**
   * Configuration used to construct the underlying QuestKitClient. Required
   * in production. When `client` is supplied (tests only), `config` is
   * ignored — but TypeScript still requires one of the two for the public
   * surface to remain unambiguous.
   *
   * The `| undefined` is explicit because the package compiles under
   * `exactOptionalPropertyTypes: true`.
   */
  config?: QuestKitConfig | undefined;
  /**
   * **Test-only escape hatch.** When set, the provider uses this client
   * instance instead of constructing a new one from `config`. The lifecycle
   * effect that calls `destroy()` on unmount is also skipped (the test is
   * responsible for its own teardown). This exists so RTL `renderHook`
   * tests can inject a fake client without spinning up real SSE/HTTP. Do
   * NOT use in production — pass `config` and let the provider own the
   * QuestKitClient.
   */
  client?: QuestKitClient | undefined;
  children: ReactNode;
}

export function QuestKitProvider({
  config,
  client: injectedClient,
  children,
}: QuestKitProviderProps): ReactElement {
  // Stash the latest config in a ref so the `useMemo` below can rebuild the
  // client when material fields change without tearing down on every render.
  const lastConfigRef = useRef(config);
  lastConfigRef.current = config;

  // We deliberately depend only on the *identity-stable* fields. Re-creating
  // the client on every getToken change would tear down the SSE stream on
  // every parent re-render — exactly the bug the doc-string warns about.
  //
  // When an `injectedClient` is provided (test shim), reuse it unchanged.
  const client = useMemo(() => {
    if (injectedClient !== undefined) return injectedClient;
    if (config === undefined) {
      throw new Error(
        "QuestKitProvider requires either `config` or `client` (test-only)",
      );
    }
    return new QuestKitClient(config);
    // Intentional shallow dep list — only identity-stable fields. See comment above.
  }, [injectedClient, config?.baseUrl, config?.appId]);

  useEffect(() => {
    // Only the provider-owned client gets destroyed on unmount. An injected
    // client is the test's responsibility.
    if (injectedClient !== undefined) return undefined;
    return () => {
      client.destroy();
    };
  }, [client, injectedClient]);

  const value = useMemo<QuestKitContextValue>(() => ({ client }), [client]);

  return (
    <QuestKitContext.Provider value={value}>
      {children}
    </QuestKitContext.Provider>
  );
}

/**
 * Hook to access the underlying QuestKitClient. Throws if called outside
 * a `<QuestKitProvider>` — by design, since silently degrading to `null`
 * would force every downstream hook to handle a "not wrapped" branch.
 */
export function useQuestKit(): QuestKitClient {
  const ctx = useContext(QuestKitContext);
  if (ctx === null) {
    throw new Error("useQuestKit() must be called inside a <QuestKitProvider>");
  }
  return ctx.client;
}
