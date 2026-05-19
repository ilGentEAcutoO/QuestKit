/**
 * CampaignBanner — render + countdown specs.
 *
 *  - Loading state has aria-busy.
 *  - Renders title + description from `useCampaign(id)`.
 *  - Renders banner <img> when bannerUrl is set; fallback div otherwise.
 *  - Countdown text appears when endAt is in the future.
 *  - "Campaign ended" when endAt <= now.
 *  - Error state: role="alert".
 */
import type { CampaignDetail } from "@questkit/core";
import type { Campaign } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";

import { CampaignBanner } from "../../src/components/CampaignBanner";
import { QuestKitProvider } from "../../src/provider";
import { type FakeClient, makeFakeClient } from "../hooks/test-utils";

function wrapperWith(
  client: FakeClient,
): (props: { children: ReactNode }) => ReactElement {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QuestKitProvider
        client={
          client as unknown as Parameters<typeof QuestKitProvider>[0]["client"]
        }
      >
        {children}
      </QuestKitProvider>
    );
  };
}

const NOW = 1_700_000_000_000;

function campaignWith(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "c1",
    title: "Spring Sale",
    description: "Best deals",
    startAt: NOW - 1000,
    endAt: NOW + 60_000,
    missionIds: ["m1"],
    ...overrides,
  };
}

describe("campaignBanner", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders without crashing in loading state", () => {
    const client = makeFakeClient({
      getCampaign: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CampaignBanner campaignId="c1" />
      </Wrapper>,
    );
    const node = document.querySelector(".qk-campaign-banner-loading");
    expect(node).not.toBeNull();
    expect(node?.getAttribute("aria-busy")).toBe("true");
  });

  it("renders title + description after fetch resolves", async () => {
    const detail: CampaignDetail = { campaign: campaignWith() };
    const client = makeFakeClient({
      getCampaign: jest.fn().mockResolvedValue(detail),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CampaignBanner campaignId="c1" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Spring Sale")).toBeInTheDocument();
    expect(screen.getByText("Best deals")).toBeInTheDocument();
  });

  it("renders banner image when bannerUrl is set", async () => {
    const detail: CampaignDetail = {
      campaign: campaignWith({ bannerUrl: "https://example.com/x.png" }),
    };
    const client = makeFakeClient({
      getCampaign: jest.fn().mockResolvedValue(detail),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CampaignBanner campaignId="c1" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const img = document.querySelector(
      ".qk-campaign-banner-image",
    ) as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe("https://example.com/x.png");
    expect(img.alt).toContain("Spring Sale");
  });

  it("renders a fallback when bannerUrl is missing", async () => {
    const detail: CampaignDetail = { campaign: campaignWith() };
    const client = makeFakeClient({
      getCampaign: jest.fn().mockResolvedValue(detail),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CampaignBanner campaignId="c1" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      document.querySelector(".qk-campaign-banner-fallback"),
    ).not.toBeNull();
    expect(document.querySelector(".qk-campaign-banner-image")).toBeNull();
  });

  it("renders countdown text when endAt is in the future", async () => {
    const detail: CampaignDetail = {
      campaign: campaignWith({ endAt: NOW + 60 * 60 * 1000 }), // 1h
    };
    const client = makeFakeClient({
      getCampaign: jest.fn().mockResolvedValue(detail),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CampaignBanner campaignId="c1" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const countdown = document.querySelector(".qk-campaign-banner-countdown");
    expect(countdown).not.toBeNull();
    expect(countdown?.textContent).toMatch(/Ends in/i);
  });

  it("renders 'Campaign ended' when endAt is in the past", async () => {
    const detail: CampaignDetail = {
      campaign: campaignWith({ endAt: NOW - 1000 }),
    };
    const client = makeFakeClient({
      getCampaign: jest.fn().mockResolvedValue(detail),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CampaignBanner campaignId="c1" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const countdown = document.querySelector(".qk-campaign-banner-countdown");
    expect(countdown).not.toBeNull();
    expect(countdown?.textContent).toMatch(/ended/i);
    expect(countdown?.getAttribute("data-ended")).toBe("true");
  });

  it("renders an error state when fetch fails", async () => {
    const client = makeFakeClient({
      getCampaign: jest.fn().mockRejectedValue(new Error("boom")),
    });
    const Wrapper = wrapperWith(client);
    render(
      <Wrapper>
        <CampaignBanner campaignId="c1" />
      </Wrapper>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Couldn’t load campaign/i);
  });
});
