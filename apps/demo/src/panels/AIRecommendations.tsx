/**
 * AIRecommendations panel — bottom-right floating toggle that shows
 * recommended missions via <RecommendedMissions> (which uses the
 * useRecommendations hook from @questkit/react).
 *
 * The panel is collapsible to keep the scenario routes uncluttered until
 * the user opts in.
 */
import { RecommendedMissions } from "@questkit/react";
import { AnimatePresence, motion } from "framer-motion";
import { type ReactElement, useState } from "react";

export function AIRecommendations(): ReactElement {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <div className="fixed bottom-4 right-4 z-30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="qk-ai-recs-panel"
        aria-label={open ? "Close AI picks panel" : "Open AI picks panel"}
        className="inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-medium shadow-lg transition-all hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
        style={{
          background: "var(--color-qk-coin)",
          color: "var(--color-qk-fg)",
        }}
      >
        <span aria-hidden="true">✨</span>
        <span>AI picks</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.aside
            id="qk-ai-recs-panel"
            role="region"
            aria-label="AI-recommended missions"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className="absolute bottom-12 right-0 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-card)] border shadow-2xl"
            style={{
              background: "var(--color-demo-surface)",
              borderColor: "var(--color-demo-border)",
            }}
          >
            <header
              className="flex items-center justify-between gap-2 border-b px-4 py-2.5"
              style={{ borderColor: "var(--color-demo-border)" }}
            >
              <div>
                <h3 className="text-sm font-semibold">Recommended for you</h3>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-demo-muted)" }}
                >
                  Workers AI · Encouraging Coach voice
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close recommendations"
                className="rounded-md px-2 py-1 text-base hover:bg-[color:var(--color-demo-surface-2)]"
              >
                <span aria-hidden="true">×</span>
              </button>
            </header>
            <div className="max-h-[60dvh] overflow-y-auto p-3">
              <RecommendedMissions />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}
