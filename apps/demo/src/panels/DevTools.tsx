/**
 * DevTools — top-right floating gear that opens a settings tray.
 *
 * Capabilities (intentionally local-only — no server endpoints):
 *   - Reset user: clear local storage + token cache so the next mint
 *     restarts state.
 *   - Theme switcher: cycles through light, dark, and a "vivid" preset.
 *     Switching does NOT trigger a React re-render — we mutate the
 *     `--qk-primary` CSS variable directly on <html>, exploiting
 *     Tailwind v4's CSS-first token model. The chosen theme is persisted
 *     to localStorage (`qk-theme`) and re-applied at first paint by the
 *     bootstrap script in index.html (no light→dark flash).
 *   - Simulate time: bumps a fake "demo clock" displayed in the tray
 *     (visual only — real time-simulation belongs to TASK-029+).
 */
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
  const [open, setOpen] = useState<boolean>(false);
  const [theme, setTheme] = useState<ThemeKey>(() => readInitialTheme());
  const [simulatedTimeOffset, setSimulatedTimeOffset] = useState<number>(0);

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

  const resetUser = useCallback((): void => {
    if (typeof window === "undefined") return;
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
  }, []);

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
              onClick={resetUser}
              className="w-full rounded-md border px-2 py-1.5 text-xs font-medium"
              style={{
                background: "var(--color-demo-surface-2)",
                borderColor: "var(--color-demo-border)",
                color: "var(--color-demo-ink)",
              }}
            >
              Reset demo user (reloads page)
            </button>
            <p
              className="text-[10px]"
              style={{ color: "var(--color-demo-muted)" }}
            >
              Clears local token cache + streak + spin cooldown. Server-side
              progress remains; sign in as a different userId for a clean slate
              (Phase 6 task).
            </p>
          </section>
        </motion.div>
      )}
    </div>
  );
}
