/**
 * PollingClient — graceful-degradation fallback for the SSE stream.
 *
 * When the SSEClient gives up (after `maxReconnectAttempts` consecutive
 * failures), the QuestKitClient flips over to this polling client. It
 * refetches missions + balances on a fixed interval and diffs the result
 * against the prior snapshot, emitting synthetic SDKUpdate values for
 * anything that changed.
 *
 * Trade-offs documented intentionally:
 *
 *   - The diff is *coarse*: we compare JSON-stringified payloads. Missed
 *     intermediate states are acceptable — the consumer cares about
 *     "current state", not "every state transition".
 *   - We emit `mission.progress` for any mission whose progress row
 *     differs (status OR currentCount OR progress). We do NOT separately
 *     emit `mission.completed` — the SSE path treats that as a status
 *     transition, but a polling client always observes the most recent
 *     state; the consumer can derive completion from `status === "completed"`.
 *   - For balances, we emit `balance.changed` for any currency whose
 *     `amount` differs (or whose row is new).
 *   - `reward.granted` is NOT emitted from polling because the API doesn't
 *     surface a "reward log" — rewards are delivered as part of the
 *     `POST /v1/missions/:id/claim` response, which the SDK consumer
 *     receives directly.
 *   - Recommendations are NOT polled (TASK-017 will deal with them).
 */
import type { Balance, MissionProgress, SDKUpdate } from "@questkit/types";

export interface PollingState {
  /** Map keyed by missionId. */
  progress: Record<string, MissionProgress>;
  /** Array of balances; we treat the whole array as the comparison unit. */
  balances: Balance[];
}

export interface PollingOpts {
  /** Fetcher closes over the QuestKitClient. */
  fetchState: () => Promise<PollingState>;
  /** Called with one or more diff updates whenever poll detects changes. */
  onChange: (updates: SDKUpdate[]) => void;
  /** Called when an individual poll throws. Defaults to a console warn. */
  onError?: (err: Error) => void;
  intervalMs?: number;
  /** Override for setInterval / clearInterval (mainly for tests). */
  setIntervalImpl?: (
    cb: () => void,
    ms: number,
  ) => ReturnType<typeof setInterval>;
  clearIntervalImpl?: (id: ReturnType<typeof setInterval>) => void;
}

const DEFAULT_INTERVAL_MS = 5000;

export class PollingClient {
  private readonly opts: PollingOpts;
  private readonly intervalMs: number;
  private readonly setIntervalImpl: NonNullable<PollingOpts["setIntervalImpl"]>;
  private readonly clearIntervalImpl: NonNullable<
    PollingOpts["clearIntervalImpl"]
  >;
  private timer: ReturnType<typeof setInterval> | null = null;
  private prev: PollingState | null = null;
  /** Re-entrancy guard so a slow poll doesn't overlap with the next tick. */
  private polling = false;

  constructor(opts: PollingOpts) {
    this.opts = opts;
    this.intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
    // Bind the browser timers to globalThis so they're not called as methods
    // on `this`. Without bind, `this.setIntervalImpl(...)` invokes the browser
    // setInterval with `this === PollingClient`, which the browser rejects
    // with "TypeError: Illegal invocation" (setInterval requires its native
    // host as receiver). Tests pass their own mock fns so the bug only
    // surfaces in real browsers.
    this.setIntervalImpl = opts.setIntervalImpl ?? setInterval.bind(globalThis);
    this.clearIntervalImpl =
      opts.clearIntervalImpl ?? clearInterval.bind(globalThis);
  }

  /** Start polling. Idempotent — calling twice has no effect after the first. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = this.setIntervalImpl(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /** Stop polling and discard the prior snapshot. */
  stop(): void {
    if (this.timer !== null) {
      this.clearIntervalImpl(this.timer);
      this.timer = null;
    }
    this.prev = null;
  }

  /** Force an immediate poll. Mainly for tests / explicit refresh actions. */
  async pollNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const next = await this.opts.fetchState();
      const updates = this.prev === null ? [] : diffStates(this.prev, next);
      // First poll establishes the baseline — we don't fire "everything
      // changed" on initial connection (the SDK consumer already has the
      // current state from its initial fetch). Subsequent polls fire deltas.
      if (this.prev !== null && updates.length > 0) {
        this.opts.onChange(updates);
      }
      this.prev = next;
    } catch (err) {
      this.opts.onError?.(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.polling = false;
    }
  }
}

/**
 * Compute the diff between two snapshots. The output is a flat list of
 * `SDKUpdate` values suitable for re-dispatch through the same listeners
 * the SSEClient feeds.
 *
 * @internal
 */
export function diffStates(
  prev: PollingState,
  next: PollingState,
): SDKUpdate[] {
  const out: SDKUpdate[] = [];

  // Mission progress diff: emit one mission.progress (or mission.completed
  // when the new status flipped to "completed") per changed mission.
  for (const [missionId, nextProg] of Object.entries(next.progress)) {
    const prevProg = prev.progress[missionId];
    if (prevProg === undefined) {
      // New progress row — always emit.
      out.push(makeProgressUpdate(nextProg));
      continue;
    }
    if (!shallowEqualProgress(prevProg, nextProg)) {
      out.push(makeProgressUpdate(nextProg));
    }
  }

  // Balance diff: build a map for O(1) lookup, then compare per currency.
  const prevByCurrency = new Map<string, Balance>();
  for (const b of prev.balances) prevByCurrency.set(b.currency, b);
  for (const nextB of next.balances) {
    const prevB = prevByCurrency.get(nextB.currency);
    if (prevB === undefined || prevB.amount !== nextB.amount) {
      out.push({ type: "balance.changed", data: nextB });
    }
  }

  return out;
}

/**
 * Build a mission.progress or mission.completed update from a progress row.
 *
 * We emit `mission.completed` only for transitions INTO completed status,
 * but at the diff layer we don't know the prior status (the caller of
 * makeProgressUpdate is in a branch that already knew the row changed).
 * To keep this simple AND correct, we always emit `mission.progress` —
 * the consumer is free to react to the embedded `status` field.
 */
function makeProgressUpdate(p: MissionProgress): SDKUpdate {
  return { type: "mission.progress", data: p };
}

function shallowEqualProgress(a: MissionProgress, b: MissionProgress): boolean {
  return (
    a.userId === b.userId &&
    a.missionId === b.missionId &&
    a.status === b.status &&
    a.progress === b.progress &&
    a.currentCount === b.currentCount &&
    a.targetCount === b.targetCount
    // updatedAt intentionally excluded — it ticks on every server-side
    // recompute even when nothing user-visible changed.
  );
}
