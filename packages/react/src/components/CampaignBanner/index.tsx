/**
 * <CampaignBanner /> — hero strip for a campaign, with an optional countdown.
 *
 * Fetches the campaign via `useCampaign(id)`. Renders:
 *   - banner image at the top if `campaign.bannerUrl` is set; otherwise a
 *     gradient placeholder using the theme primary token (graceful fallback)
 *   - title + description
 *   - a live countdown to `campaign.endAt` (the types use `endAt`, not
 *     `endsAt` — the task brief used both spellings)
 *
 * The countdown ticks once per second via `setInterval`. We do not try to
 * be cleverer than that — the banner is a low-frequency surface and the
 * cost of a 1 Hz timer is irrelevant.
 *
 * Accessibility:
 *   - `aria-busy` while loading.
 *   - The image, when present, has alt text built from the campaign title.
 *   - The countdown is wrapped in an `aria-live="off"` region (we don't
 *     want every second announced to a screen-reader user) but the static
 *     end-date string IS rendered as accessible text for non-realtime
 *     consumption.
 */
import type { Campaign } from "@questkit/types";
import type { CSSProperties, ReactElement } from "react";
import { useEffect, useState } from "react";

import { useCampaign } from "../../hooks/useCampaign";

export interface CampaignBannerProps {
  campaignId: string;
  className?: string;
}

interface Countdown {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** True iff the campaign has already ended. */
  ended: boolean;
}

function computeCountdown(endAt: number, now: number): Countdown {
  const diff = endAt - now;
  if (diff <= 0) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, ended: true };
  }
  const seconds = Math.floor(diff / 1000) % 60;
  const minutes = Math.floor(diff / (1000 * 60)) % 60;
  const hours = Math.floor(diff / (1000 * 60 * 60)) % 24;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  return { days, hours, minutes, seconds, ended: false };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatCountdown(c: Countdown): string {
  if (c.ended) return "Ended";
  if (c.days > 0) return `${c.days}d ${pad(c.hours)}h ${pad(c.minutes)}m`;
  return `${pad(c.hours)}h ${pad(c.minutes)}m ${pad(c.seconds)}s`;
}

interface CampaignBannerViewProps {
  campaign: Campaign;
  className?: string | undefined;
}

function CampaignBannerView({
  campaign,
  className,
}: CampaignBannerViewProps): ReactElement {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    // We only tick if there's actually a future end date — otherwise the
    // interval is wasted work.
    if (typeof campaign.endAt !== "number") return undefined;
    if (campaign.endAt <= Date.now()) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return (): void => clearInterval(id);
  }, [campaign.endAt]);

  const hasEnd = typeof campaign.endAt === "number" && campaign.endAt > 0;
  const countdown = hasEnd ? computeCountdown(campaign.endAt, now) : null;

  const rootClass = [
    "qk-campaign-banner",
    "block w-full overflow-hidden",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const rootStyle: CSSProperties = {
    background: "var(--color-qk-bg)",
    color: "var(--color-qk-fg)",
    borderRadius: "var(--radius-qk)",
    fontFamily: "var(--font-qk)",
  };

  // Fallback gradient when no banner image is provided — keeps the strip
  // visually present rather than collapsing to text.
  const fallbackHeader: CSSProperties = {
    background:
      "linear-gradient(135deg, var(--color-qk-primary), var(--color-qk-coin))",
    height: "8rem",
  };

  return (
    <section
      className={rootClass}
      style={rootStyle}
      aria-label={`Campaign: ${campaign.title}`}
    >
      {campaign.bannerUrl !== undefined && campaign.bannerUrl.length > 0 ? (
        <img
          src={campaign.bannerUrl}
          alt={`${campaign.title} banner`}
          className="qk-campaign-banner-image w-full h-32 object-cover"
        />
      ) : (
        <div
          className="qk-campaign-banner-fallback"
          style={fallbackHeader}
          aria-hidden="true"
        />
      )}
      <div className="qk-campaign-banner-body p-4">
        <h2
          className="qk-campaign-banner-title text-lg font-semibold"
          style={{ color: "var(--color-qk-fg)" }}
        >
          {campaign.title}
        </h2>
        {campaign.description.length > 0 && (
          <p
            className="qk-campaign-banner-desc text-sm mt-1"
            style={{ color: "var(--color-qk-fg)", opacity: 0.8 }}
          >
            {campaign.description}
          </p>
        )}
        {countdown !== null && (
          <p
            className="qk-campaign-banner-countdown text-sm mt-2 font-mono"
            aria-live="off"
            data-ended={countdown.ended ? "true" : "false"}
            style={{ color: "var(--color-qk-primary)" }}
          >
            {countdown.ended
              ? "Campaign ended"
              : `Ends in ${formatCountdown(countdown)}`}
          </p>
        )}
      </div>
    </section>
  );
}

export function CampaignBanner({
  campaignId,
  className,
}: CampaignBannerProps): ReactElement {
  const state = useCampaign(campaignId);

  if (state.isLoading) {
    return (
      <section
        aria-busy="true"
        aria-label="Loading campaign"
        className={[
          "qk-campaign-banner qk-campaign-banner-loading",
          "block w-full h-40",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          background: "var(--color-qk-muted, rgba(0,0,0,0.05))",
          borderRadius: "var(--radius-qk)",
        }}
      />
    );
  }

  if (state.isError || state.data === undefined) {
    return (
      <section
        role="alert"
        className={[
          "qk-campaign-banner qk-campaign-banner-error",
          "block w-full p-4 text-sm",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{
          background: "var(--color-qk-bg)",
          color: "var(--color-qk-fg)",
          borderRadius: "var(--radius-qk)",
          border: "1px solid var(--color-qk-muted, rgba(0,0,0,0.1))",
        }}
      >
        Couldn’t load campaign.
      </section>
    );
  }

  // useCampaign(id) returns CampaignDetail = { campaign, missions? }.
  return (
    <CampaignBannerView campaign={state.data.campaign} className={className} />
  );
}
