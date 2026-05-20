/**
 * E-commerce scenario — 6 mock products, "Buy" fires purchase.completed.
 *
 * Aligned with the seed missions in workers/api/migrations/0002:
 *   - Triple Treat (daily, count 3)
 *   - Power User (lifetime, electronics + amount >= 50)
 *   - Variety Pack (weekly, in [books, games, toys] count 5)
 *
 * Each product carries an `amount` and `category` so the fired payload
 * exercises the full filter matrix.
 */
import {
  CampaignBanner,
  MissionList,
  useEvent,
  useQuestKit,
} from "@questkit/react";
import { motion } from "framer-motion";
import { type ReactElement, useCallback, useState } from "react";

import { useDemoToast } from "../components/DemoToastHost";
import { SceneHeading } from "../components/SceneHeading";

interface Product {
  id: string;
  name: string;
  category: "electronics" | "books" | "games" | "toys" | "apparel" | "food";
  price: number;
  emoji: string;
}

const PRODUCTS: Product[] = [
  {
    id: "p_macbook",
    name: "MacBook Pro M4",
    category: "electronics",
    price: 1999,
    emoji: "💻",
  },
  {
    id: "p_headphones",
    name: "Wireless Headphones",
    category: "electronics",
    price: 79,
    emoji: "🎧",
  },
  {
    id: "p_novel",
    name: "The Pragmatic Coder",
    category: "books",
    price: 24,
    emoji: "📚",
  },
  {
    id: "p_board_game",
    name: "Star Realms Deluxe",
    category: "games",
    price: 39,
    emoji: "🎲",
  },
  {
    id: "p_lego",
    name: "LEGO City Set",
    category: "toys",
    price: 49,
    emoji: "🧱",
  },
  {
    id: "p_snack",
    name: "Artisan Cookies (12pk)",
    category: "food",
    price: 12,
    emoji: "🍪",
  },
];

export function EcommerceRoute(): ReactElement {
  const { fireEvent, isFiring } = useEvent();
  const client = useQuestKit();
  const { show: showToast } = useDemoToast();
  const [buying, setBuying] = useState<string | null>(null);

  /**
   * Mission-claim handler wired into <MissionList onClaim>. Without this the
   * MissionCard's Claim button fires its analytics event but never actually
   * POSTs to /v1/missions/:id/claim — the user sees the button toggle to
   * "Claiming…" and then back to "Claim" with no balance change. Surfaced by
   * the live click-through PDCA sweep.
   */
  const handleClaim = useCallback(
    async (missionId: string): Promise<void> => {
      try {
        const result = await client.claimMission(missionId);
        showToast(result.reward);
      } catch (err) {
        // Best-effort. The mission card will revert from "Claiming…" via its
        // own finally block; we don't need a UI rollback here. Errors land
        // in the EventLog drawer through the SDK's existing error path.
        console.warn("[ecommerce] claim failed", err);
      }
    },
    [client, showToast],
  );

  async function handleBuy(product: Product): Promise<void> {
    setBuying(product.id);
    try {
      await fireEvent({
        name: "purchase.completed",
        payload: {
          productId: product.id,
          category: product.category,
          amount: product.price,
        },
      });
    } catch {
      // Errors are surfaced via the useEvent hook's `error` slot, which
      // appears in the EventLog panel — no toast spam here.
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="space-y-8">
      <SceneHeading
        emoji="🛒"
        title="E-commerce shop"
        description="Click Buy on any product to fire purchase.completed with the matching category and amount. Watch the EventLog drawer and the mission cards update in real time."
      />

      {/* Reserve vertical space so CampaignBanner's load-in doesn't shift
       *  the catalog below it (Lighthouse CLS). The banner self-collapses
       *  when there's no campaign, so the placeholder height is harmless
       *  even when the banner stays empty. */}
      <div className="min-h-[6rem]">
        <CampaignBanner campaignId="camp_ecom_2026q2" />
      </div>

      <section aria-labelledby="catalog-heading" className="space-y-3">
        <h3
          id="catalog-heading"
          className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-demo-muted)]"
        >
          Catalog
        </h3>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((product) => (
            <motion.li
              key={product.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border p-4"
              style={{
                background: "var(--color-demo-surface-2)",
                borderColor: "var(--color-demo-border)",
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div aria-hidden="true" className="text-3xl">
                  {product.emoji}
                </div>
                <span
                  className="rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                  style={{
                    background: "var(--color-qk-bg)",
                    color: "var(--color-qk-fg)",
                  }}
                >
                  {product.category}
                </span>
              </div>
              <div className="flex-1">
                <h4 className="text-base font-semibold leading-snug">
                  {product.name}
                </h4>
                <p
                  className="mt-1 text-sm"
                  style={{ color: "var(--color-demo-muted)" }}
                >
                  ${product.price.toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleBuy(product);
                }}
                disabled={isFiring && buying === product.id}
                aria-label={`Buy now: ${product.name} for $${product.price}`}
                className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-sm font-semibold text-white transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[color:var(--color-qk-primary)]"
                style={{ background: "var(--color-qk-primary)" }}
              >
                {isFiring && buying === product.id ? "Processing…" : "Buy now"}
              </button>
            </motion.li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="missions-heading" className="space-y-3">
        <h3
          id="missions-heading"
          className="text-sm font-semibold uppercase tracking-wide text-[color:var(--color-demo-muted)]"
        >
          Active missions
        </h3>
        <MissionList campaignId="camp_ecom_2026q2" onClaim={handleClaim} />
      </section>
    </div>
  );
}
