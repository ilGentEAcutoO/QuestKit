import type { ReactElement } from "react";
import { CoinBalance } from "@questkit/react";
import { NavLink, Outlet } from "react-router-dom";

import { AIRecommendations } from "../panels/AIRecommendations";
import { DevTools } from "../panels/DevTools";
import { EventLog } from "../panels/EventLog";

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

export function Layout(): ReactElement {
  return (
    <div className="flex min-h-dvh flex-col">
      <header
        className="sticky top-0 z-30 border-b backdrop-blur-md"
        style={{
          background:
            "color-mix(in oklch, var(--color-demo-surface) 88%, transparent)",
          borderColor: "var(--color-demo-border)",
        }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
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
                className="text-xs leading-tight"
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
                        "inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] px-3 py-1.5 text-sm font-medium transition-colors",
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
            className="hidden items-center gap-2 rounded-[var(--radius-pill)] px-3 py-1.5 text-sm sm:flex"
            style={{ background: "var(--color-demo-surface-2)" }}
          >
            <span aria-hidden="true">🪙</span>
            <CoinBalance currency="coin" animated />
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
                      "flex flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "text-[color:var(--color-qk-primary)]"
                        : "text-[color:var(--color-demo-muted)]",
                    ].join(" ")
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

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>

      <footer
        className="border-t px-4 py-4 text-center text-xs sm:px-6"
        style={{
          borderColor: "var(--color-demo-border)",
          color: "var(--color-demo-muted)",
        }}
      >
        QuestKit v0.1.0 — open source gamification SDK on Cloudflare Workers.
      </footer>

      {/* Floating panels — pure overlays, no layout impact. */}
      <DevTools />
      <AIRecommendations />
      <EventLog />
    </div>
  );
}
