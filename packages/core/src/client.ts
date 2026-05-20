/**
 * QuestKitClient — the public-facing SDK class.
 *
 * One client per (baseUrl, appId, userId) tuple. Construct once at app
 * boot, call `destroy()` on teardown. The client owns:
 *
 *   - request()          — uniform HTTP layer with auth header injection
 *                          and error mapping (HTTP non-2xx → QuestKitError).
 *   - events queue       — at-least-once event delivery with exp backoff.
 *   - SSE wrapper        — lazy-initialised on first subscribe(), with
 *                          automatic fallback to polling on give-up.
 *   - polling fallback   — synthesises SDKUpdate events from periodic
 *                          state diffs.
 *
 * The class surface mirrors the server contract verbatim — every method
 * corresponds to one or more routes on `questkit-worker-api`. Return
 * types come from `@questkit/types` (no SDK-private domain types).
 */
import type {
  Balance,
  Campaign,
  Mission,
  MissionProgress,
  Reward,
  SDKUpdate,
} from "@questkit/types";

import { QuestKitError } from "./errors";
import {
  EventQueue,
  type QueuedEvent,
  type SendFn,
  type SendResult,
} from "./event-queue";
import { PollingClient, type PollingState } from "./polling";
import { SSEClient } from "./sse";
import { detectStorage, type Storage } from "./storage";

export interface QuestKitConfig {
  /** API base URL, e.g. "https://api.questkit.jairukchan.com" (no trailing slash). */
  baseUrl: string;
  /** Application identifier (used for the `mintToken` call). */
  appId: string;
  /**
   * Resolver for the JWT bearer token. Sync or async. Called before every
   * request (and SSE connect / reconnect). Implementers MAY cache the token
   * — the SDK does not memoize.
   */
  getToken: () => Promise<string> | string;
  /** Optional override for the storage adapter (default: detectStorage()). */
  storage?: Storage;
  /** Optional fetch override (mainly for testing). */
  fetchImpl?: typeof fetch;
  /** Poll interval used when the SSE stream gives up. Default 5000ms. */
  pollIntervalMs?: number;
  /**
   * Per-request timeout for the SDK's REST fetches (mintToken, fireEvent,
   * authedFetch). Default 10000ms. The SSE long-poll deliberately does NOT
   * honour this — it has its own lifetime managed by the reconnect loop.
   *
   * On timeout the request rejects with `QuestKitError({code:"timeout"})`
   * so callers (and hooks like `useEvent`) can recover instead of leaving
   * an `isFiring` / `isClaiming` flag stuck forever.
   */
  timeoutMs?: number;
}

export interface FireEventInput {
  name: string;
  payload: Record<string, unknown>;
  /** Defaults to Date.now() if absent. */
  timestamp?: number;
  /** If absent, one will be generated for queue-safety. */
  idempotencyKey?: string;
}

export interface FireEventResult {
  /** True on direct success; false when the event was queued for retry. */
  accepted: boolean;
  eventId: string | null;
  missionsUpdated: string[];
  /** Set when the event was queued instead of accepted immediately. */
  queued?: boolean;
}

export interface MissionsListOpts {
  campaignId?: string;
  status?: "active" | "completed" | "claimed" | "locked" | "all";
  limit?: number;
  cursor?: string;
}

export interface MissionsListResponse {
  missions: Mission[];
  progress: Record<string, MissionProgress>;
  nextCursor?: string;
}

export interface ClaimResult {
  progress: MissionProgress;
  balance: Balance | null;
  reward: Reward;
}

export interface CampaignsListOpts {
  includeExpired?: boolean;
}

export interface CampaignDetail {
  campaign: Campaign;
  missions?: Mission[];
}

/**
 * Result shape returned by `getRecommendations()` — mirrors the
 * `/v1/recommendations` route response. `cached` indicates the response was
 * served from the server-side KV cache (no AI inference); `count` is the
 * length of `missionIds` after hallucination filtering.
 */
export interface RecommendationsResult {
  missionIds: string[];
  reason: string;
  cached: boolean;
  count: number;
}

interface MintTokenInput {
  appSecret: string;
  userId: string;
}

interface MintTokenResult {
  token: string;
  expiresAt: number;
}

/** Default request timeout (ms) — see QuestKitConfig.timeoutMs. */
const DEFAULT_TIMEOUT_MS = 10_000;

export class QuestKitClient {
  private readonly baseUrl: string;
  private readonly appId: string;
  private readonly getTokenFn: () => Promise<string> | string;
  private readonly fetchImpl: typeof fetch;
  private readonly storage: Storage;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly events: EventQueue;
  /** SSE client — lazy-created on first subscribe(). */
  private sse: SSEClient | null = null;
  /** Polling fallback — created on SSE give-up. */
  private polling: PollingClient | null = null;
  /** All consumer-side SDKUpdate listeners. One SSE -> many subscribers. */
  private readonly listeners = new Set<(u: SDKUpdate) => void>();
  /** Set on destroy() so post-destroy calls fail-fast. */
  private destroyed = false;

  constructor(config: QuestKitConfig) {
    if (typeof config.baseUrl !== "string" || config.baseUrl.length === 0) {
      throw new QuestKitError(
        "QuestKitConfig.baseUrl is required",
        "config_error",
      );
    }
    // Normalize: strip trailing slash so we can always do `${base}/v1/x`.
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.appId = config.appId;
    this.getTokenFn = config.getToken;
    // Bind fetch to globalThis so `this.fetchImpl(...)` doesn't invoke it as
    // a method on the QuestKitClient instance — the browser's native fetch
    // rejects that with "TypeError: Illegal invocation" (same root cause as
    // the setInterval issue in polling.ts). Tests inject their own fetchImpl
    // so the bug only surfaces in real browsers.
    this.fetchImpl = config.fetchImpl ?? fetch.bind(globalThis);
    this.storage = config.storage ?? detectStorage();
    this.pollIntervalMs = config.pollIntervalMs ?? 5000;
    // Allow `timeoutMs: 0` to mean "no timeout" (mainly for tests that drive
    // a never-resolving fetch by hand). Negative / NaN values fall back to
    // the default to avoid an immediately-aborting client.
    const configured = config.timeoutMs;
    this.timeoutMs =
      typeof configured === "number" && configured >= 0
        ? configured
        : DEFAULT_TIMEOUT_MS;
    this.events = new EventQueue({ storage: this.storage });
  }

  /**
   * Internal fetch helper — wraps `this.fetchImpl` with a per-request
   * AbortSignal timeout and re-throws AbortError as a stable
   * `QuestKitError({code:"timeout"})`. EVERY REST call in this client goes
   * through here so a slow / down API can never wedge UI state.
   *
   * The SSE stream (sse.ts) is deliberately NOT routed through this helper:
   * SSE is a long-poll by design, the AbortController it owns belongs to
   * the reconnect loop, and a timeout here would convert healthy idle
   * streams into reconnect storms.
   *
   * If the caller passes their own `signal` we honour it AND the timeout —
   * the request aborts on whichever fires first. (Current callers don't,
   * but the contract makes this future-proof when a host wants to cancel
   * an in-flight claim on unmount.)
   */
  private async request(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    // `timeoutMs: 0` opt-out — pass through the caller's init untouched.
    if (this.timeoutMs === 0) {
      return this.fetchImpl(url, init);
    }
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal =
      init.signal === undefined || init.signal === null
        ? timeoutSignal
        : anyAbortSignal([init.signal, timeoutSignal]);
    try {
      return await this.fetchImpl(url, { ...init, signal });
    } catch (err) {
      // AbortSignal.timeout fires a DOMException("TimeoutError"); a
      // user-aborted controller fires DOMException("AbortError"). We only
      // map the OUR-side timeout to QuestKitError — caller-aborted requests
      // rethrow verbatim so host code can distinguish unmount-cancel from
      // a slow server.
      if (isTimeoutAbort(err, timeoutSignal)) {
        throw new QuestKitError(
          `request timed out after ${this.timeoutMs}ms`,
          "timeout",
        );
      }
      throw err;
    }
  }

  // ============================================================
  // Auth
  // ============================================================

  /**
   * Server-issued JWT mint. Typically called once at boot from a SERVER-
   * SIDE context (the appSecret should NEVER reach the browser). The SDK
   * exposes this so server-rendered apps can mint a token, hand it to the
   * client via cookie/hydration, and let `getToken()` return it on the
   * client side.
   *
   * POST /v1/auth/token
   *   body: { appId, appSecret, userId }
   *   200: { token, expiresAt }
   */
  async mintToken(input: MintTokenInput): Promise<MintTokenResult> {
    const resp = await this.request(`${this.baseUrl}/v1/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        appId: this.appId,
        appSecret: input.appSecret,
        userId: input.userId,
      }),
    });
    if (!resp.ok) {
      throw await this.errorFromResponse(resp);
    }
    return (await resp.json()) as MintTokenResult;
  }

  // ============================================================
  // Events
  // ============================================================

  /**
   * Fire an analytics event. The SDK attempts an immediate POST first;
   * on a 5xx (server error) or network failure the event is enqueued for
   * retry. On a 4xx (client error) we throw — the caller's payload was
   * structurally wrong and retrying won't fix it.
   *
   * Return shape:
   *   - 200: { accepted: true, eventId, missionsUpdated }
   *   - queued (5xx / offline): { accepted: false, eventId: null,
   *                               missionsUpdated: [], queued: true }
   */
  async fireEvent(input: FireEventInput): Promise<FireEventResult> {
    this.ensureAlive();
    const idempotencyKey =
      input.idempotencyKey ?? this.generateIdempotencyKey();
    const timestamp = input.timestamp ?? Date.now();
    const userId = await this.resolveUserId();

    const event = {
      userId,
      name: input.name,
      payload: input.payload,
      timestamp,
      idempotencyKey,
    };

    // Try once immediately; on transient failure, enqueue + return queued.
    // A request-timeout is treated identically to any other network failure:
    // the event is durable in the queue and the background flush will
    // retry — the caller's `isFiring` flag clears via the resolved promise.
    const sendFn: SendFn = async (e): Promise<SendResult> => {
      try {
        const token = await this.getTokenFn();
        const resp = await this.request(`${this.baseUrl}/v1/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "idempotency-key": e.idempotencyKey ?? "",
          },
          body: JSON.stringify(e),
        });
        if (resp.ok) {
          const body = (await resp.json()) as {
            accepted: true;
            eventId: string;
            missionsUpdated: string[];
          };
          return {
            ok: true,
            eventId: body.eventId,
            missionsUpdated: body.missionsUpdated,
          };
        }
        // Retry on 5xx and 408/429; drop on other 4xx.
        const retryable =
          resp.status >= 500 || resp.status === 408 || resp.status === 429;
        return { ok: false, status: resp.status, retryable };
      } catch {
        // Network-level failure (incl. QuestKitError(timeout)) — definitely
        // retryable. The event is queued; the foreground promise resolves
        // with `queued: true` so the caller's UI flag can clear.
        return { ok: false, status: 0, retryable: true };
      }
    };

    const result = await sendFn(event);
    if (result.ok) {
      return {
        accepted: true,
        eventId: result.eventId,
        missionsUpdated: result.missionsUpdated,
      };
    }

    // Drop on non-retryable 4xx (caller passed bad data — surface it).
    if (!result.retryable) {
      throw new QuestKitError(
        `fireEvent rejected with status ${result.status}`,
        result.status === 401
          ? "unauthorized"
          : result.status === 403
            ? "forbidden"
            : result.status === 400
              ? "validation_error"
              : "server_error",
        result.status,
      );
    }

    // Retryable — queue and let the background flush handle it.
    this.events.enqueue(event);
    // Kick off a background flush (the eligible item should already be due).
    void this.events.flush(sendFn);
    return {
      accepted: false,
      eventId: null,
      missionsUpdated: [],
      queued: true,
    };
  }

  /** Force-flush the event queue. Used by the host when connectivity returns. */
  async flushEvents(): Promise<void> {
    this.ensureAlive();
    const sendFn: SendFn = async (e): Promise<SendResult> => {
      try {
        const token = await this.getTokenFn();
        const resp = await this.request(`${this.baseUrl}/v1/events`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "idempotency-key": e.idempotencyKey ?? "",
          },
          body: JSON.stringify(e),
        });
        if (resp.ok) {
          const body = (await resp.json()) as {
            accepted: true;
            eventId: string;
            missionsUpdated: string[];
          };
          return {
            ok: true,
            eventId: body.eventId,
            missionsUpdated: body.missionsUpdated,
          };
        }
        const retryable =
          resp.status >= 500 || resp.status === 408 || resp.status === 429;
        return { ok: false, status: resp.status, retryable };
      } catch {
        return { ok: false, status: 0, retryable: true };
      }
    };
    await this.events.flush(sendFn);
  }

  /** Current event queue depth. */
  queueDepth(): number {
    return this.events.size();
  }

  /** Visible-for-tests snapshot of the event queue. */
  queueSnapshot(): readonly QueuedEvent[] {
    return this.events.snapshot();
  }

  // ============================================================
  // Missions
  // ============================================================

  async getMissions(
    opts: MissionsListOpts = {},
  ): Promise<MissionsListResponse> {
    this.ensureAlive();
    const query = buildQuery({
      campaignId: opts.campaignId,
      status: opts.status,
      limit: opts.limit,
      cursor: opts.cursor,
    });
    const resp = await this.authedFetch(`/v1/missions${query}`, {
      method: "GET",
    });
    if (!resp.ok) throw await this.errorFromResponse(resp);
    return (await resp.json()) as MissionsListResponse;
  }

  async getMission(
    id: string,
  ): Promise<{ mission: Mission; progress: MissionProgress | null }> {
    this.ensureAlive();
    const resp = await this.authedFetch(
      `/v1/missions/${encodeURIComponent(id)}`,
      {
        method: "GET",
      },
    );
    if (!resp.ok) throw await this.errorFromResponse(resp);
    return (await resp.json()) as {
      mission: Mission;
      progress: MissionProgress | null;
    };
  }

  async claimMission(
    id: string,
    opts: { idempotencyKey?: string } = {},
  ): Promise<ClaimResult> {
    this.ensureAlive();
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (opts.idempotencyKey !== undefined) {
      headers["idempotency-key"] = opts.idempotencyKey;
    }
    const resp = await this.authedFetch(
      `/v1/missions/${encodeURIComponent(id)}/claim`,
      { method: "POST", headers },
    );
    if (!resp.ok) throw await this.errorFromResponse(resp);
    return (await resp.json()) as ClaimResult;
  }

  // ============================================================
  // Balance
  // ============================================================

  async getBalances(): Promise<Balance[]> {
    this.ensureAlive();
    const resp = await this.authedFetch("/v1/balance", { method: "GET" });
    if (!resp.ok) throw await this.errorFromResponse(resp);
    const body = (await resp.json()) as { balances: Balance[] };
    return body.balances;
  }

  /**
   * Get the balance for a single currency. Always resolves to a `Balance`
   * (the server returns a synthetic `{ amount: 0 }` zero-state when the
   * user has never had a row in this currency), so the return type is
   * `Balance` rather than `Balance | null`. Non-2xx responses throw.
   *
   * Compatibility: prior to v0.1.0 this returned `null` on 404; that path
   * is unreachable now but harmless if a downstream consumer still checks
   * for null.
   */
  async getBalance(currency: string): Promise<Balance> {
    this.ensureAlive();
    const resp = await this.authedFetch(
      `/v1/balance/${encodeURIComponent(currency)}`,
      { method: "GET" },
    );
    if (!resp.ok) throw await this.errorFromResponse(resp);
    const body = (await resp.json()) as { balance: Balance };
    return body.balance;
  }

  // ============================================================
  // Campaigns
  // ============================================================

  async getCampaigns(opts: CampaignsListOpts = {}): Promise<Campaign[]> {
    this.ensureAlive();
    const query = buildQuery({
      include: opts.includeExpired === true ? "expired" : undefined,
    });
    const resp = await this.authedFetch(`/v1/campaigns${query}`, {
      method: "GET",
    });
    if (!resp.ok) throw await this.errorFromResponse(resp);
    const body = (await resp.json()) as { campaigns: Campaign[] };
    return body.campaigns;
  }

  async getCampaign(
    id: string,
    opts: { includeMissions?: boolean } = {},
  ): Promise<CampaignDetail> {
    this.ensureAlive();
    const query = buildQuery({
      include: opts.includeMissions === true ? "missions" : undefined,
    });
    const resp = await this.authedFetch(
      `/v1/campaigns/${encodeURIComponent(id)}${query}`,
      { method: "GET" },
    );
    if (!resp.ok) throw await this.errorFromResponse(resp);
    return (await resp.json()) as CampaignDetail;
  }

  // ============================================================
  // Recommendations (TASK-017)
  // ============================================================

  /**
   * Fetch AI-recommended missions for the current user. The server caches
   * results per-user in KV for 1 hour (`cached: true` on hits). The hook
   * `useRecommendations` adds an additional 5-minute in-memory cache to
   * avoid hammering the endpoint when multiple `<RecommendedMissions>`
   * mount in the same render pass.
   *
   * GET /v1/recommendations
   *   200: { missionIds, reason, cached, count }
   *   502: { error: "ai_response_malformed" } — LLM returned non-JSON
   *   503: { error: "ai_unavailable" }       — AI binding outage
   */
  async getRecommendations(): Promise<RecommendationsResult> {
    this.ensureAlive();
    const resp = await this.authedFetch("/v1/recommendations", {
      method: "GET",
    });
    if (!resp.ok) throw await this.errorFromResponse(resp);
    return (await resp.json()) as RecommendationsResult;
  }

  /**
   * Public accessor for the current userId derived from the JWT's `sub`
   * claim. Exposed (TASK-017) so the React `useRecommendations` hook can
   * scope its in-memory cache per-user — without this, a multi-user host
   * app would mix recommendations across users. Internally delegates to
   * `resolveUserId` which is otherwise private.
   *
   * Returns the same value `fireEvent`'s body field uses; safe to call
   * repeatedly (no caching here — `getToken()` is the caller's caching
   * surface).
   */
  async getUserId(): Promise<string> {
    this.ensureAlive();
    return this.resolveUserId();
  }

  // ============================================================
  // SSE / real-time
  // ============================================================

  /**
   * Subscribe to SDK updates (mission progress, balance changes, etc.).
   * Multiple subscribers share one SSE connection; the connection is
   * established lazily on the first call and torn down when the last
   * subscriber unregisters.
   *
   * Returns an unsubscribe function.
   */
  subscribe(cb: (update: SDKUpdate) => void): () => void {
    this.ensureAlive();
    this.listeners.add(cb);
    if (this.listeners.size === 1) {
      // First subscriber — open the SSE stream.
      this.ensureSse();
    }
    return () => {
      this.listeners.delete(cb);
      if (this.listeners.size === 0) {
        // Last subscriber gone — close the stream.
        this.teardownStream();
      }
    };
  }

  // ============================================================
  // Lifecycle
  // ============================================================

  /**
   * Tear down the client: cancel SSE, stop polling, drop all listeners.
   * After destroy(), every method throws `QuestKitError("destroyed")`.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.teardownStream();
    this.listeners.clear();
  }

  // ============================================================
  // Internals
  // ============================================================

  private ensureAlive(): void {
    if (this.destroyed) {
      throw new QuestKitError(
        "QuestKitClient has been destroyed",
        "config_error",
      );
    }
  }

  private async authedFetch(
    path: string,
    init: Omit<RequestInit, "headers"> & {
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const baseHeaders = init.headers ?? {};
    const { headers: _ignored, ...rest } = init;

    // Single-shot retry on 401: caller's getToken() may have returned a stale
    // or empty token (race on first mount, expired since cache populated, or
    // server rotated JWT_SECRET). Re-fetch the token once and replay. If the
    // retry also 401s the response bubbles up — that's a real auth failure,
    // not a transient race.
    const attempt = async (): Promise<Response> => {
      const token = await this.getTokenFn();
      const headers: Record<string, string> = {
        ...baseHeaders,
        authorization: `Bearer ${token}`,
      };
      return this.request(url, { ...rest, headers });
    };

    const first = await attempt();
    if (first.status !== 401) return first;
    return attempt();
  }

  private async errorFromResponse(resp: Response): Promise<QuestKitError> {
    let code = "server_error";
    let message = `HTTP ${resp.status}`;
    if (resp.status === 401) code = "unauthorized";
    else if (resp.status === 403) code = "forbidden";
    else if (resp.status === 404) code = "not_found";
    else if (resp.status === 400) code = "validation_error";
    else if (resp.status === 429) code = "rate_limited";
    else if (resp.status >= 500) code = "server_error";
    // Try to read a body — server errors typically include `{ error: "..." }`.
    try {
      const ct = resp.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = (await resp.json()) as { error?: string };
        if (typeof body.error === "string") message = body.error;
      }
    } catch {
      // Ignore body-read errors — we already have a status-based message.
    }
    return new QuestKitError(message, code, resp.status);
  }

  /**
   * Resolve the userId from the current token. The JWT's `sub` claim
   * carries it, but we deliberately avoid parsing the JWT in the SDK
   * (no library dep, no algorithm-confusion attack surface). Instead, we
   * require the consumer to pass `userId` on each `fireEvent` call —
   * for now we just look it up from a recent claim. This implementation
   * uses a heuristic: extract `sub` from the JWT payload (base64url-
   * decoded, no signature check — we trust it because it's our own token).
   */
  private async resolveUserId(): Promise<string> {
    const token = await this.getTokenFn();
    // Quick JWT payload parse — split on ".", decode the middle segment.
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new QuestKitError(
        "invalid token shape (not a JWT)",
        "config_error",
      );
    }
    try {
      const payloadStr = parts[1] ?? "";
      const padded = payloadStr.padEnd(
        payloadStr.length + ((4 - (payloadStr.length % 4)) % 4),
        "=",
      );
      const b64 = padded.replace(/-/g, "+").replace(/_/g, "/");
      // atob is available in browsers; in Node (where atob is also available
      // since v16, but defensively we fall back to a textual decode via a
      // platform-neutral path).
      const json = atob(b64);
      const payload = JSON.parse(json) as { sub?: unknown };
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new Error("missing sub");
      }
      return payload.sub;
    } catch (err) {
      throw new QuestKitError(
        `unable to extract userId from token: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "config_error",
      );
    }
  }

  private generateIdempotencyKey(): string {
    if (
      typeof crypto !== "undefined" &&
      typeof crypto.randomUUID === "function"
    ) {
      return crypto.randomUUID();
    }
    return `qk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /** Lazily start the SSE stream + wire up its handlers. */
  private ensureSse(): void {
    if (this.sse !== null) return;
    this.sse = new SSEClient({
      baseUrl: this.baseUrl,
      getToken: this.getTokenFn,
      fetchImpl: this.fetchImpl,
      onUpdate: (u) => {
        this.dispatchToListeners(u);
      },
      onGiveUp: () => {
        // SSE exhausted — degrade to polling.
        this.sse = null;
        this.startPolling();
      },
    });
    void this.sse.connect();
  }

  private startPolling(): void {
    if (this.polling !== null) return;
    this.polling = new PollingClient({
      intervalMs: this.pollIntervalMs,
      fetchState: async (): Promise<PollingState> => {
        // Fetch current state in parallel.
        const [missionsResp, balances] = await Promise.all([
          this.getMissions().catch(
            () => ({ missions: [], progress: {} }) as MissionsListResponse,
          ),
          this.getBalances().catch(() => [] as Balance[]),
        ]);
        return { progress: missionsResp.progress, balances };
      },
      onChange: (updates) => {
        for (const u of updates) this.dispatchToListeners(u);
      },
    });
    this.polling.start();
  }

  private dispatchToListeners(update: SDKUpdate): void {
    for (const cb of this.listeners) {
      try {
        cb(update);
      } catch {
        // A throwing listener shouldn't kill fanout to the others.
      }
    }
  }

  private teardownStream(): void {
    if (this.sse !== null) {
      this.sse.disconnect();
      this.sse = null;
    }
    if (this.polling !== null) {
      this.polling.stop();
      this.polling = null;
    }
  }
}

/**
 * Detect whether a fetch rejection was caused by OUR timeout signal firing.
 *
 * We can't just look for `err.name === "AbortError"` — that would also
 * catch caller-driven abort (e.g. host code calling `controller.abort()`
 * to cancel on unmount), which the caller probably wants to handle
 * differently than a server timeout. So we check two things:
 *
 *   1. The dedicated timeout signal we created has aborted. This is the
 *      authoritative bit: if it fired, the fetch was aborted because of
 *      us, regardless of which other signals may have been involved.
 *   2. The thrown error looks like an abort (DOMException with name
 *      "TimeoutError" / "AbortError" or a Node `AbortError`).
 *
 * Both conditions together mean "our timeout caused this rejection".
 */
function isTimeoutAbort(err: unknown, timeoutSignal: AbortSignal): boolean {
  if (!timeoutSignal.aborted) return false;
  if (err instanceof Error) {
    const name = err.name;
    if (name === "TimeoutError" || name === "AbortError") return true;
    // DOMException with code 20 (ABORT_ERR) — the spec-compliant name on
    // some legacy runtimes is just "AbortError" but the code is stable.
    const maybeDom = err as { code?: number };
    if (maybeDom.code === 20) return true;
  }
  return false;
}

/**
 * Combine multiple AbortSignals into one — the returned signal aborts
 * when ANY input signal aborts. Equivalent to `AbortSignal.any([...])`
 * which exists in Node 20+ and modern browsers, but we polyfill for
 * older runtimes (Workers, Safari < 17) by wiring up an internal
 * controller.
 *
 * If `AbortSignal.any` exists on the runtime, defer to it for accurate
 * `signal.reason` propagation; otherwise emit a controller-driven
 * approximation that aborts on first input fire.
 */
function anyAbortSignal(signals: AbortSignal[]): AbortSignal {
  // Prefer the standard implementation when available.
  const native = (
    AbortSignal as unknown as {
      any?: (sigs: AbortSignal[]) => AbortSignal;
    }
  ).any;
  if (typeof native === "function") {
    return native.call(AbortSignal, signals);
  }
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener(
      "abort",
      () => {
        controller.abort(s.reason);
      },
      { once: true },
    );
  }
  return controller.signal;
}

/**
 * Build a `?k=v&k2=v2` query string from a key→value record, skipping
 * undefined and null. Values are URL-encoded. Returns "" when no params.
 */
function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.length === 0) continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s.length === 0 ? "" : `?${s}`;
}
