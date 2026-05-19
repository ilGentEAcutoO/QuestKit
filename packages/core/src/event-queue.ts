/**
 * EventQueue — persistent client-side event buffer with exp-backoff retry.
 *
 * Why we need this: the SDK is meant to be deployed in browsers where
 * connectivity flickers, tabs background-throttle, and users close the tab
 * mid-flush. Events that we drop on the floor cost the host app real
 * money (missed missions = missed conversions). The queue gives at-least-
 * once delivery semantics on top of the server's idempotency layer:
 *
 *   - On enqueue: dedup by `idempotencyKey` (last-write-wins on metadata
 *     but the event itself is preserved exactly once).
 *   - On flush: process sequentially, exp-backoff on 5xx, give up after
 *     `maxAttempts` per event (drop + return in `failed`).
 *   - Bounded size: drop oldest when full so a burst of events never OOMs
 *     localStorage (~5 MB cap per origin).
 *   - Persistence: write the queue back on every mutation; load on
 *     construction. JSON-serialised via the Storage adapter.
 *
 * The retry path mirrors the server's idempotency design — the server
 * keeps a KV cache for 24h, so retries within that window are observed as
 * replays (`X-Idempotent-Replay: hit`).
 */
import type { Event } from "@questkit/types";
import type { Storage } from "./storage";

export interface QueuedEvent extends Event {
  /** Number of send attempts so far. Increments on each retry. */
  attempts: number;
  /** Epoch-ms timestamp before which the event should not be retried. */
  nextRetryAt: number;
  /**
   * Idempotency key — always populated for queued events. If the original
   * `Event.idempotencyKey` is absent we generate one at enqueue so retries
   * are safe.
   */
  idempotencyKey: string;
}

export interface EventQueueOpts {
  storage: Storage;
  storageKey?: string;
  maxQueueSize?: number;
  maxAttempts?: number;
  baseBackoffMs?: number;
  /** Override for now-source so tests can advance time deterministically. */
  now?: () => number;
}

/**
 * The signature the queue calls to actually send an event.
 *
 * Returning `{ ok: false, retryable: true }` triggers exp-backoff retry.
 * Returning `{ ok: false, retryable: false }` drops the event immediately
 * (e.g. 4xx validation error — retrying won't help).
 */
export type SendResult =
  | { ok: true; eventId: string; missionsUpdated: string[] }
  | { ok: false; status: number; retryable: boolean };

export type SendFn = (event: Event) => Promise<SendResult>;

export interface FlushResult {
  sent: number;
  failed: number;
  dropped: number;
}

const DEFAULT_STORAGE_KEY = "qk:event-queue";
const DEFAULT_MAX_QUEUE = 100;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_BACKOFF_MS = 1000;

/**
 * Generate a cryptographically-random idempotency key. We prefer
 * `crypto.randomUUID()` (universally available in modern browsers + Node 19+);
 * fallback is a timestamp + random base36 mash for ancient runtimes.
 */
function generateIdempotencyKey(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback for very old environments. Not cryptographically perfect but
  // collision-resistant enough for an idempotency key tied to a userId.
  return `qk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class EventQueue {
  private readonly storage: Storage;
  private readonly storageKey: string;
  private readonly maxQueueSize: number;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly now: () => number;
  private queue: QueuedEvent[];
  private listeners = new Set<(depth: number) => void>();
  /**
   * Re-entrancy guard. Two parallel `flush()` calls would otherwise both try
   * to process the head of the queue and double-send. We bail out of the
   * second call cleanly — the original flush will drain the queue.
   */
  private flushing = false;

  constructor(opts: EventQueueOpts) {
    this.storage = opts.storage;
    this.storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
    this.maxQueueSize = opts.maxQueueSize ?? DEFAULT_MAX_QUEUE;
    this.maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.baseBackoffMs = opts.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
    this.now = opts.now ?? (() => Date.now());
    this.queue = this.load();
  }

  /**
   * Enqueue an event for later flush.
   *
   * Dedup rule: if an event with the same `idempotencyKey` already exists in
   * the queue, we replace it (the new event wins — payload may have grown
   * with fresher data; the key guarantees the server only counts it once).
   *
   * Bound rule: if the queue is at `maxQueueSize`, drop the oldest entry to
   * make room. This trades correctness for liveness — old events may have
   * already been duplicated by other paths, and the alternative (block
   * enqueue) would freeze the host UI.
   */
  enqueue(event: Event): QueuedEvent {
    const idempotencyKey = event.idempotencyKey ?? generateIdempotencyKey();
    const queued: QueuedEvent = {
      ...event,
      idempotencyKey,
      attempts: 0,
      nextRetryAt: 0,
    };

    const existingIdx = this.queue.findIndex(
      (e) => e.idempotencyKey === idempotencyKey,
    );
    if (existingIdx !== -1) {
      // Dedup: replace existing.
      this.queue[existingIdx] = queued;
    } else {
      // Bounded push: drop oldest if at capacity.
      if (this.queue.length >= this.maxQueueSize) {
        this.queue.shift();
      }
      this.queue.push(queued);
    }

    this.persist();
    this.notify();
    return queued;
  }

  /**
   * Flush all eligible events sequentially.
   *
   * "Eligible" = `nextRetryAt <= now()`. Events with a future retry time are
   * skipped this round; the next `flush()` will pick them up.
   *
   * On 5xx (server-side, retryable): increment `attempts`, schedule exp-
   * backoff (`baseBackoffMs * 2^attempts`), leave in queue.
   *
   * On 4xx (client-side, NOT retryable, e.g. validation error): drop. The
   * caller already returned the failure synchronously when the event was
   * first attempted; the retried event would fail the same way.
   *
   * On `attempts >= maxAttempts`: drop with a warn (best-effort delivery).
   */
  async flush(send: SendFn): Promise<FlushResult> {
    if (this.flushing) {
      // Re-entry — drain inside the in-flight flush; nothing to do here.
      return { sent: 0, failed: 0, dropped: 0 };
    }
    this.flushing = true;
    let sent = 0;
    let failed = 0;
    let dropped = 0;
    try {
      // Snapshot — new events can arrive (enqueue() mutates this.queue) while
      // we're iterating; they'll be picked up by the next flush().
      const snapshot = [...this.queue];
      for (const item of snapshot) {
        const now = this.now();
        if (item.nextRetryAt > now) {
          // Not eligible yet; leave alone.
          continue;
        }
        try {
          const result = await send(this.toEvent(item));
          if (result.ok) {
            // Sent successfully — remove from queue.
            this.removeByKey(item.idempotencyKey);
            sent += 1;
          } else if (!result.retryable) {
            // Client error — drop, count as failed (caller will see one
            // dropped event in the result but not a re-attempt cycle).
            this.removeByKey(item.idempotencyKey);
            failed += 1;
          } else {
            // Retryable failure — bump attempts, schedule backoff.
            const newAttempts = item.attempts + 1;
            if (newAttempts >= this.maxAttempts) {
              this.removeByKey(item.idempotencyKey);
              dropped += 1;
            } else {
              this.updateItem(item.idempotencyKey, (it) => ({
                ...it,
                attempts: newAttempts,
                nextRetryAt: now + this.baseBackoffMs * 2 ** newAttempts,
              }));
            }
          }
        } catch {
          // Network-level throw (offline, DNS, AbortError mid-flight).
          // Treat as retryable transient failure.
          const newAttempts = item.attempts + 1;
          if (newAttempts >= this.maxAttempts) {
            this.removeByKey(item.idempotencyKey);
            dropped += 1;
          } else {
            this.updateItem(item.idempotencyKey, (it) => ({
              ...it,
              attempts: newAttempts,
              nextRetryAt: this.now() + this.baseBackoffMs * 2 ** newAttempts,
            }));
          }
        }
      }
    } finally {
      this.flushing = false;
      this.persist();
      this.notify();
    }
    return { sent, failed, dropped };
  }

  /** Register a change listener — fires on every enqueue + after each flush. */
  onChange(cb: (depth: number) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  /** Current queue depth (regardless of retry-readiness). */
  size(): number {
    return this.queue.length;
  }

  /** Visible for tests — snapshot of the current queue. */
  snapshot(): readonly QueuedEvent[] {
    return [...this.queue];
  }

  /** Clear all queued events (useful on logout / user switch). */
  clear(): void {
    this.queue = [];
    this.persist();
    this.notify();
  }

  // --- internal helpers ---

  private toEvent(q: QueuedEvent): Event {
    return {
      userId: q.userId,
      name: q.name,
      payload: q.payload,
      timestamp: q.timestamp,
      idempotencyKey: q.idempotencyKey,
    };
  }

  private removeByKey(key: string): void {
    this.queue = this.queue.filter((e) => e.idempotencyKey !== key);
  }

  private updateItem(
    key: string,
    transform: (e: QueuedEvent) => QueuedEvent,
  ): void {
    this.queue = this.queue.map((e) =>
      e.idempotencyKey === key ? transform(e) : e,
    );
  }

  private persist(): void {
    try {
      this.storage.set(this.storageKey, JSON.stringify(this.queue));
    } catch {
      // Storage failed — likely quota. Already handled by the adapter,
      // re-catch is paranoid but cheap.
    }
  }

  private load(): QueuedEvent[] {
    const raw = this.storage.get(this.storageKey);
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      // Type-narrow on essential fields; drop malformed entries silently.
      return parsed.filter(isQueuedEvent);
    } catch {
      return [];
    }
  }

  private notify(): void {
    const depth = this.queue.length;
    for (const cb of this.listeners) {
      try {
        cb(depth);
      } catch {
        // Listener threw — don't let it kill the queue. Operators can
        // observe via the host app's normal error reporting.
      }
    }
  }
}

function isQueuedEvent(x: unknown): x is QueuedEvent {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.userId === "string" &&
    typeof o.name === "string" &&
    typeof o.payload === "object" &&
    o.payload !== null &&
    typeof o.timestamp === "number" &&
    typeof o.idempotencyKey === "string" &&
    typeof o.attempts === "number" &&
    typeof o.nextRetryAt === "number"
  );
}
