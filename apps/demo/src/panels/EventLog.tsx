import type { SDKUpdate } from "@questkit/types";
/**
 * EventLog — toggleable bottom drawer that surfaces live SDK updates via
 * QuestKitClient.subscribe. Filter by type with a tag chip strip.
 *
 * The drawer is keyboard-accessible:
 *   - A FAB at bottom-right toggles open/close.
 *   - Inside the drawer, Tab cycles through filter chips + the clear button.
 *   - Escape closes the drawer.
 *
 * The log holds the last 200 events in memory (FIFO). Real production
 * tooling would persist to IndexedDB; for a demo the in-memory cap is fine.
 */
import { useQuestKit } from "@questkit/react";
import { AnimatePresence, motion } from "framer-motion";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const MAX_ENTRIES = 200;

type FilterKey = "all" | SDKUpdate["type"];

interface LogEntry {
  id: number;
  receivedAt: number;
  update: SDKUpdate;
}

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "mission.progress", label: "Progress" },
  { key: "mission.completed", label: "Completed" },
  { key: "mission.claimed", label: "Claimed" },
  { key: "reward.granted", label: "Reward" },
  { key: "balance.changed", label: "Balance" },
];

function describeUpdate(update: SDKUpdate): string {
  switch (update.type) {
    case "mission.progress":
      return `mission ${update.data.missionId} → ${Math.round(update.data.progress * 100)}%`;
    case "mission.completed":
      return `mission ${update.data.missionId} completed`;
    case "mission.claimed":
      // Phase 9 / TASK-001 — the dedicated claim broadcast. Carries the
      // post-claim MissionProgress so consumers know the card flipped to
      // status="claimed" (driving the disabled "Claimed" button).
      return `mission ${update.data.missionId} claimed`;
    case "reward.granted":
      return update.data.reward.kind === "currency"
        ? `+${update.data.reward.amount} ${update.data.reward.currency}`
        : update.data.reward.kind === "badge"
          ? `badge ${update.data.reward.badgeId}`
          : `${update.data.reward.quantity}× ${update.data.reward.itemId}`;
    case "balance.changed":
      return `balance ${update.data.currency} → ${update.data.amount}`;
    case "recommendation":
      return `${update.data.missionIds.length} recommended`;
    default: {
      // Exhaustiveness guard — unreachable if all SDKUpdate types covered.
      const _exhaustive: never = update;
      return JSON.stringify(_exhaustive);
    }
  }
}

export function EventLog(): ReactElement {
  const client = useQuestKit();
  const [open, setOpen] = useState<boolean>(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<FilterKey>("all");
  const nextIdRef = useRef<number>(0);

  useEffect(() => {
    const unsub = client.subscribe((update: SDKUpdate) => {
      setEntries((prev) => {
        const id = nextIdRef.current++;
        const next: LogEntry = { id, receivedAt: Date.now(), update };
        const merged = [...prev, next];
        if (merged.length > MAX_ENTRIES) {
          return merged.slice(merged.length - MAX_ENTRIES);
        }
        return merged;
      });
    });
    return unsub;
  }, [client]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter((e) => e.update.type === filter);
  }, [entries, filter]);

  const clear = useCallback((): void => {
    setEntries([]);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="qk-event-log-drawer"
        aria-label={open ? "Close event log" : "Open event log"}
        className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium shadow-lg transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
        style={{
          background: "var(--color-qk-fg)",
          color: "var(--color-qk-bg)",
        }}
      >
        <span aria-hidden="true">📡</span>
        <span>Event log</span>
        {entries.length > 0 && (
          <span
            className="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
            style={{
              background: "var(--color-qk-primary)",
              color: "var(--color-qk-bg)",
            }}
          >
            {entries.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.aside
            id="qk-event-log-drawer"
            role="log"
            aria-label="QuestKit event log"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
            className="fixed inset-x-2 bottom-2 z-40 flex max-h-[60dvh] flex-col overflow-hidden rounded-[var(--radius-card)] border shadow-2xl sm:inset-x-4 sm:bottom-4"
            style={{
              background: "var(--color-demo-surface)",
              borderColor: "var(--color-demo-border)",
            }}
          >
            <header
              className="flex items-center justify-between gap-3 border-b px-4 py-2.5"
              style={{ borderColor: "var(--color-demo-border)" }}
            >
              <div>
                <h3 className="text-sm font-semibold">Live SDK updates</h3>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-demo-muted)" }}
                >
                  Streamed via QuestKitClient.subscribe (SSE → polling fallback)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-md px-2 py-1 text-xs font-medium hover:bg-[color:var(--color-demo-surface-2)]"
                  style={{ color: "var(--color-demo-muted)" }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close event log"
                  className="rounded-md px-2 py-1 text-base hover:bg-[color:var(--color-demo-surface-2)]"
                >
                  <span aria-hidden="true">×</span>
                </button>
              </div>
            </header>

            <div
              role="tablist"
              aria-label="Filter events by type"
              className="flex flex-wrap gap-1.5 border-b px-4 py-2"
              style={{ borderColor: "var(--color-demo-border)" }}
            >
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  role="tab"
                  aria-selected={filter === opt.key}
                  onClick={() => setFilter(opt.key)}
                  className={[
                    "rounded-[var(--radius-pill)] px-3 py-1 text-xs font-medium transition-colors",
                    filter === opt.key
                      ? "text-white"
                      : "text-[color:var(--color-demo-muted)] hover:bg-[color:var(--color-demo-surface-2)]",
                  ].join(" ")}
                  style={
                    filter === opt.key
                      ? { background: "var(--color-qk-primary)" }
                      : undefined
                  }
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-2">
              {filtered.length === 0 ? (
                <p
                  className="py-6 text-center text-sm"
                  style={{ color: "var(--color-demo-muted)" }}
                >
                  No events yet — interact with a scenario to generate one.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 font-mono text-xs">
                  {filtered.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-start gap-2 rounded-md px-2 py-1.5"
                      style={{ background: "var(--color-demo-surface-2)" }}
                    >
                      <time
                        dateTime={new Date(entry.receivedAt).toISOString()}
                        className="shrink-0 tabular-nums"
                        style={{ color: "var(--color-demo-muted)" }}
                      >
                        {new Date(entry.receivedAt).toLocaleTimeString([], {
                          hour12: false,
                        })}
                      </time>
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                        style={{
                          background: "var(--color-qk-primary)",
                          color: "white",
                        }}
                      >
                        {entry.update.type}
                      </span>
                      <span className="flex-1 break-all">
                        {describeUpdate(entry.update)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
