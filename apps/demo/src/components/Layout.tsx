import type { Balance } from "@questkit/types";

import { useBalance } from "@questkit/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  lazy,
  type ReactElement,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";

// Footer reads the canonical version from the monorepo root package.json
// so future bumps (e.g. TASK-008 → 0.1.5) propagate without code edits.
// Vite resolves JSON imports natively at build time; TS picks it up via the
// inherited `resolveJsonModule: true` in tsconfig.base.json.
import pkg from "../../../../package.json";

import { CoinIcon } from "./icons";

// TASK-014 / F5-b — the demo seeds three reward currencies across
// migrations 0002–0004 (coin via Daily Watcher / Lucky Spinner;
// gem via Variety Pack; point via Deep Diver). The header MUST show
// all three even when the server has no row yet so users learn what
// currencies exist before they've claimed anything. Sorting is fixed
// (coin → gem → point) so the pill doesn't shuffle as SSE updates land.
const DEMO_CURRENCIES = ["coin", "gem", "point"] as const;
type DemoCurrency = (typeof DEMO_CURRENCIES)[number];
const CURRENCY_GLYPH: Record<DemoCurrency, string> = {
  coin: "¢",
  gem: "◆",
  point: "★",
};
const CURRENCY_COLOR_VAR: Record<DemoCurrency, string> = {
  // coin keeps the existing brand token; gem/point use the existing
  // demo palette tokens — purple-ish accent for gem, blue-ish for point
  // so the three are visually distinguishable without introducing new
  // CSS custom properties.
  coin: "var(--color-qk-coin)",
  gem: "oklch(0.62 0.20 320)",
  point: "oklch(0.58 0.18 250)",
};

// Defer floating panels to a separate chunk so the initial visual frame
// (header + main content) ships without their framer-motion / SSE wiring.
// We render them after first paint via requestIdleCallback / setTimeout so
// Lighthouse's LCP element resolves before this chunk even fetches.
const AIRecommendations = lazy(() =>
  import("../panels/AIRecommendations").then((m) => ({
    default: m.AIRecommendations,
  })),
);
const BadgeWall = lazy(() =>
  import("../panels/BadgeWall").then((m) => ({ default: m.BadgeWall })),
);
const DevTools = lazy(() =>
  import("../panels/DevTools").then((m) => ({ default: m.DevTools })),
);
const EventLog = lazy(() =>
  import("../panels/EventLog").then((m) => ({ default: m.EventLog })),
);

function useAfterFirstPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    // Run after the browser has painted the initial frame. We prefer
    // requestIdleCallback (delivers when the main thread is idle) and
    // fall back to a 0ms setTimeout for browsers without it.
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void) => number;
      }
    ).requestIdleCallback;
    if (typeof idle === "function") {
      const id = idle(() => setReady(true));
      return () => {
        const cancel = (
          window as unknown as {
            cancelIdleCallback?: (handle: number) => void;
          }
        ).cancelIdleCallback;
        if (typeof cancel === "function") cancel(id);
      };
    }
    const t = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(t);
  }, []);
  return ready;
}

interface NavItem {
  to: string;
  label: string;
  emoji: string;
}

const NAV: NavItem[] = [
  { to: "/ecommerce", label: "E-commerce", emoji: "🛒" },
  { to: "/streaming", label: "Streaming", emoji: "📺" },
  { to: "/daily", label: "Daily Streak", emoji: "📅" },
  { to: "/minigames", label: "Mini-Games", emoji: "🎰" },
];

function BalanceMulti(): ReactElement {
  // List-mode useBalance returns one Balance per currency the server has
  // a row for. Currencies the user has never earned are absent from the
  // array — we backfill them at 0 so the pill always renders all three
  // and the user learns the demo's currency vocabulary (F5-b user
  // complaint: gem reward was minted but invisible).
  const state = useBalance();
  const reduced = useReducedMotion();

  const amounts = useMemo<Record<DemoCurrency, number>>(() => {
    const list = Array.isArray(state.data) ? (state.data as Balance[]) : [];
    const map: Record<DemoCurrency, number> = { coin: 0, gem: 0, point: 0 };
    for (const b of list) {
      if ((DEMO_CURRENCIES as readonly string[]).includes(b.currency)) {
        map[b.currency as DemoCurrency] = b.amount;
      }
    }
    return map;
  }, [state.data]);

  // The pulse key is the concatenated state — any currency change
  // re-runs the scale animation so SSE-driven mints are visually
  // noticeable. Coin keeps its prominent treatment; gem + point sit
  // beside it as smaller chips so the header stays compact.
  const pulseKey = `${amounts.coin}|${amounts.gem}|${amounts.point}`;
  const ariaLabel = `Current balance: ${amounts.coin} coin, ${amounts.gem} gem, ${amounts.point} point`;

  return (
    <motion.div
      key={pulseKey}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
      animate={reduced ? { scale: 1 } : { scale: [1, 1.18, 1] }}
      transition={
        reduced ? { duration: 0 } : { duration: 0.4, ease: "easeOut" }
      }
      className="inline-flex items-center gap-2 font-medium tabular-nums"
    >
      {/* Coin — keeps the SVG icon for brand continuity */}
      <span
        className="inline-flex items-center gap-1"
        style={{ color: CURRENCY_COLOR_VAR.coin }}
        data-currency="coin"
      >
        <CoinIcon />
        <span aria-hidden="true">{amounts.coin.toLocaleString()}</span>
        <span aria-hidden="true" className="text-sm opacity-70">
          coin
        </span>
      </span>
      {/* Gem + point — compact chips, glyph + amount + label */}
      {(["gem", "point"] as const).map((c) => (
        <span
          key={c}
          className="inline-flex items-center gap-1 border-l pl-2"
          style={{
            color: CURRENCY_COLOR_VAR[c],
            borderColor: "var(--color-demo-border)",
          }}
          data-currency={c}
        >
          <span aria-hidden="true" className="text-base leading-none">
            {CURRENCY_GLYPH[c]}
          </span>
          <span aria-hidden="true">{amounts[c].toLocaleString()}</span>
          <span aria-hidden="true" className="text-sm opacity-70">
            {c}
          </span>
        </span>
      ))}
    </motion.div>
  );
}

export function Layout(): ReactElement {
  const location = useLocation();
  const reduced = useReducedMotion();
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="absolute left-2 top-2 z-50 -translate-y-12 rounded-md px-3 py-1.5 text-sm font-medium shadow-md transition-transform focus-visible:translate-y-0 focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{
          background: "var(--color-qk-primary)",
          color: "white",
        }}
      >
        Skip to content
      </a>
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{
          background:
            "color-mix(in oklch, var(--color-demo-surface) 88%, transparent)",
          borderColor: "var(--color-demo-border)",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-3 py-3 sm:gap-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-[var(--radius-card)] text-lg font-bold text-white"
              style={{ background: "var(--color-qk-primary)" }}
            >
              Q
            </div>
            <div>
              <h1 className="text-base font-semibold leading-tight">
                QuestKit Demo
              </h1>
              <p
                className="hidden text-xs leading-tight sm:block"
                style={{ color: "var(--color-demo-muted)" }}
              >
                4 scenarios · live SSE · AI recs
              </p>
            </div>
          </div>
          <nav aria-label="Demo scenarios" className="hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      [
                        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]",
                        isActive
                          ? "text-white"
                          : "text-[color:var(--color-demo-muted)] hover:bg-[color:var(--color-demo-surface-2)] hover:text-[color:var(--color-demo-ink)]",
                      ].join(" ")
                    }
                    style={({ isActive }) =>
                      isActive
                        ? { background: "var(--color-qk-primary)" }
                        : undefined
                    }
                  >
                    <span aria-hidden="true">{item.emoji}</span>
                    <span>{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <div
            className="flex items-center gap-2 rounded-[var(--radius-pill)] px-3 py-1.5 text-sm"
            style={{ background: "var(--color-demo-surface-2)" }}
          >
            <BalanceMulti />
          </div>
        </div>
        <nav aria-label="Demo scenarios (mobile)" className="md:hidden">
          <ul className="mx-auto flex max-w-6xl overflow-x-auto px-2 pb-2">
            {NAV.map((item) => (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]",
                      isActive
                        ? "text-[color:var(--color-demo-ink)]"
                        : "text-[color:var(--color-demo-muted)]",
                    ].join(" ")
                  }
                  style={({ isActive }) =>
                    isActive
                      ? {
                          background: "var(--color-demo-surface-2)",
                        }
                      : undefined
                  }
                >
                  <span aria-hidden="true" className="text-lg">
                    {item.emoji}
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-6 sm:py-6"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={reduced ? false : { opacity: 0, y: 4 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 1 } : { opacity: 0 }}
            transition={reduced ? { duration: 0 } : { duration: 0.15 }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <footer
        className="border-t px-3 py-4 text-center text-xs sm:px-6"
        style={{
          borderColor: "var(--color-demo-border)",
          color: "var(--color-demo-muted)",
        }}
      >
        QuestKit v{pkg.version} — open source gamification SDK on Cloudflare
        Workers.
      </footer>

      {/* Floating panels — pure overlays, no layout impact.
       *  Deferred to a separate chunk + only mounted after first paint so
       *  the initial LCP element renders before this chunk even downloads. */}
      <DeferredPanels />
    </div>
  );
}

function DeferredPanels(): ReactElement | null {
  const ready = useAfterFirstPaint();
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <DevTools />
      <AIRecommendations />
      <BadgeWall />
      <EventLog />
    </Suspense>
  );
}
