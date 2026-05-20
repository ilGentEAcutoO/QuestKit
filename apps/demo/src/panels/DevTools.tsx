/**
 * DevTools — top-right floating gear that opens a settings tray.
 *
 * Capabilities:
 *   - Reset user: Phase 8 / TASK-003 — calls the server-side
 *     `POST /v1/demo/reset` to wipe mission_progress / balances / events
 *     for the current demo userId, then clears the local token cache +
 *     reloads. Refuses non-demo users with a 403 (the JWT carries
 *     `kind: "demo"` only when minted via the demo proxy).
 *   - Theme switcher: cycles through light, dark, and a "vivid" preset.
 *     Switching does NOT trigger a React re-render — we mutate the
 *     `--qk-primary` CSS variable directly on <html>, exploiting
 *     Tailwind v4's CSS-first token model. The chosen theme is persisted
 *     to localStorage (`qk-theme`) and re-applied at first paint by the
 *     bootstrap script in index.html (no light→dark flash).
 *   - Simulate time: bumps a fake "demo clock" displayed in the tray
 *     (visual only — real time-simulation belongs to TASK-029+).
 */
import { useQuestKit } from "@questkit/react";
import { motion } from "framer-motion";
import { type ReactElement, useCallback, useEffect, useState } from "react";

import { clearTokenCache } from "../lib/auth";

type ThemeKey = "light" | "dark" | "vivid";

interface ThemePreset {
  key: ThemeKey;
  label: string;
  htmlAttr: string;
  primary: string;
  coin: string;
}

const THEMES: ThemePreset[] = [
  {
    key: "light",
    label: "Light",
    htmlAttr: "light",
    // Darker indigo to keep AA contrast with white text on CTA buttons
    // (Lighthouse target ≥ 4.5:1; this is 8.6:1).
    primary: "#3730a3",
    coin: "#b45309",
  },
  {
    key: "dark",
    label: "Dark",
    htmlAttr: "dark",
    // White text on indigo-600 lands at 6.07:1 — keeps AA on dark theme.
    primary: "#4f46e5",
    coin: "#fbbf24",
  },
  {
    key: "vivid",
    label: "Vivid",
    htmlAttr: "light",
    primary: "#be123c", // rose-700 — 5.9:1 vs white
    coin: "#15803d", // green-700 — 4.8:1 vs white
  },
];

const STORAGE_KEYS_TO_CLEAR = ["qk-demo-daily-streak", "qk-spin-demo-spin"];
const THEME_STORAGE_KEY = "qk-theme";

function readInitialTheme(): ThemeKey {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "vivid") {
      return saved;
    }
  } catch {
    // ignore — privacy mode etc.
  }
  if (typeof window.matchMedia === "function") {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch {
      // ignore
    }
  }
  return "light";
}

export function DevTools(): ReactElement {
  const client = useQuestKit();
  const [open, setOpen] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeKey>(() => readInitialTheme());
  const [simulatedTimeOffset, setSimulatedTimeOffset] = useState<number>(0);
  const [resetState, setResetState] = useState<"idle" | "pending" | "error">(
    "idle",
  );
  const [resetError, setResetError] = useState<string | null>(null);

  const applyTheme = useCallback((key: ThemeKey): void => {
    const preset = THEMES.find((t) => t.key === key);
    if (!preset) return;
    if (typeof document === "undefined") return;
    document.documentElement.dataset.theme = preset.htmlAttr;
    document.documentElement.style.setProperty(
      "--color-qk-primary",
      preset.primary,
    );
    document.documentElement.style.setProperty("--color-qk-coin", preset.coin);
    document.documentElement.style.setProperty(
      "--color-demo-accent",
      preset.primary,
    );
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, key);
    } catch {
      // privacy mode — best-effort only.
    }
    // Keep <meta name="theme-color"> in sync with the active surface so
    // browser chrome (mobile address bar / PWA) tracks the theme.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute(
        "content",
        preset.htmlAttr === "dark" ? "#1e1b4b" : "#6366f1",
      );
    }
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  const resetUser = useCallback(async (): Promise<void> => {
    if (typeof window === "undefined") return;
    setResetState("pending");
    setResetError(null);
    try {
      // Server wipe FIRST — if this fails we don't trash the local cache
      // (otherwise the user reloads into a half-reset state).
      await client.demoReset();
    } catch (err) {
      // Surface a short, actionable message under the button. The most
      // likely cause in production is a real (non-demo) userId — the
      // server returns 403 "not_demo_user" in that case.
      const message = err instanceof Error ? err.message : String(err);
      setResetState("error");
      setResetError(message);
      return;
    }
    clearTokenCache();
    for (const key of STORAGE_KEYS_TO_CLEAR) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ignore
      }
    }
    // Hard reload keeps the demo's React state-and-token cleanup atomic.
    window.location.reload();
  }, [client]);

  return (
    <div className="fixed right-4 top-20 z-40 sm:top-24">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="qk-devtools-tray"
        aria-label={open ? "Close DevTools" : "Open DevTools"}
        className="grid h-10 w-10 place-items-center rounded-full shadow-lg transition-all hover:brightness-110 active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
        style={{
          background: "var(--color-qk-fg)",
          color: "var(--color-qk-bg)",
        }}
      >
        <span aria-hidden="true">⚙️</span>
      </button>

      {open && (
        <motion.div
          id="qk-devtools-tray"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18 }}
          role="dialog"
          aria-label="DevTools"
          className="mt-2 w-72 rounded-[var(--radius-card)] border p-4 shadow-xl"
          style={{
            background: "var(--color-demo-surface)",
            borderColor: "var(--color-demo-border)",
          }}
        >
          <header className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">DevTools</h3>
            <span
              className="text-xs"
              style={{ color: "var(--color-demo-muted)" }}
            >
              Local only
            </span>
          </header>

          <section className="space-y-2">
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--color-demo-muted)" }}
            >
              Theme
            </p>
            <div
              role="radiogroup"
              aria-label="Theme preset"
              className="flex gap-1.5"
            >
              {THEMES.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  role="radio"
                  aria-checked={theme === preset.key}
                  onClick={() => setTheme(preset.key)}
                  className={[
                    "flex-1 rounded-md border px-2 py-1.5 text-xs font-medium",
                    theme === preset.key
                      ? "text-white"
                      : "text-[color:var(--color-demo-muted)]",
                  ].join(" ")}
                  style={{
                    background:
                      theme === preset.key
                        ? preset.primary
                        : "var(--color-demo-surface-2)",
                    borderColor: "var(--color-demo-border)",
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>

          <section className="mt-3 space-y-2">
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--color-demo-muted)" }}
            >
              Simulated clock
            </p>
            <p className="text-xs" style={{ color: "var(--color-demo-muted)" }}>
              Visual only — advances a counter shown below. Real time-warp
              belongs to a server dev-mode endpoint and is out of scope for
              v0.1.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSimulatedTimeOffset((n) => n + 24)}
                className="rounded-md px-2 py-1 text-xs font-medium"
                style={{ background: "var(--color-demo-surface-2)" }}
              >
                +24h
              </button>
              <button
                type="button"
                onClick={() => setSimulatedTimeOffset(0)}
                className="rounded-md px-2 py-1 text-xs font-medium"
                style={{ background: "var(--color-demo-surface-2)" }}
              >
                Reset
              </button>
              <span
                className="ml-auto text-xs tabular-nums"
                style={{ color: "var(--color-demo-muted)" }}
              >
                +{simulatedTimeOffset}h
              </span>
            </div>
          </section>

          <section className="mt-3 space-y-2">
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "var(--color-demo-muted)" }}
            >
              Reset
            </p>
            <button
              type="button"
              onClick={() => {
                void resetUser();
              }}
              disabled={resetState === "pending"}
              aria-busy={resetState === "pending"}
              className="flex w-full items-center justify-center gap-2 rounded-md border px-2 py-1.5 text-xs font-medium disabled:cursor-wait disabled:opacity-70"
              style={{
                background: "var(--color-demo-surface-2)",
                borderColor: "var(--color-demo-border)",
                color: "var(--color-demo-ink)",
              }}
            >
              {resetState === "pending" && (
                <span
                  aria-hidden="true"
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-r-transparent"
                />
              )}
              {resetState === "pending"
                ? "Resetting…"
                : "Reset demo user (reloads page)"}
            </button>
            {resetState === "error" && resetError !== null && (
              <p
                role="alert"
                className="text-[10px]"
                style={{ color: "#b91c1c" }}
              >
                {resetError}
              </p>
            )}
            <p
              className="text-[10px]"
              style={{ color: "var(--color-demo-muted)" }}
            >
              Clears server-side progress, balance, and event history.
            </p>
          </section>
        </motion.div>
      )}
    </div>
  );
}
