import type { Campaign } from "@questkit/types";
import type { ReactElement, ReactNode } from "react";

import { type CampaignDetail, QuestKitError } from "@questkit/core";
/**
 * useCampaign — TDD specs.
 *
 * Two modes:
 *   - useCampaign("c1")       → fetches single campaign via getCampaign(id),
 *                                data: { campaign, missions? }
 *   - useCampaign()           → fetches list via getCampaigns(),
 *                                data: Campaign[]
 *
 * Behaviour:
 *   1. Loading then success for both modes.
 *   2. Errors surface via `error`.
 *   3. id change → refetch.
 *   4. No SSE coupling (campaigns are catalog-like, not realtime).
 *   5. refetch() works.
 */
import { act, renderHook, waitFor } from "@testing-library/react";

import { useCampaign } from "../../src/hooks/useCampaign";
import { QuestKitProvider } from "../../src/provider";
import { type FakeClient, makeFakeClient } from "./test-utils";

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

const campaign1: Campaign = {
  id: "c1",
  title: "Summer",
  description: "summer fun",
  startAt: 1,
  endAt: 2,
  missionIds: ["m1"],
};

const detail: CampaignDetail = { campaign: campaign1 };

describe("useCampaign", () => {
  it("loading then success for a single campaign", async () => {
    const client = makeFakeClient({
      getCampaign: jest.fn().mockResolvedValue(detail),
    });
    const { result } = renderHook(() => useCampaign("c1"), {
      wrapper: wrapperWith(client),
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(detail);
    expect(client.getCampaign).toHaveBeenCalledWith("c1");
  });

  it("loading then success for the list mode (no id)", async () => {
    const list = [campaign1];
    const client = makeFakeClient({
      getCampaigns: jest.fn().mockResolvedValue(list),
    });
    const { result } = renderHook(() => useCampaign(), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(list);
    expect(client.getCampaigns).toHaveBeenCalledTimes(1);
  });

  it("records errors", async () => {
    const boom = new QuestKitError("nope", "not_found", 404);
    const client = makeFakeClient({
      getCampaign: jest.fn().mockRejectedValue(boom),
    });
    const { result } = renderHook(() => useCampaign("c1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe(boom);
  });

  it("wraps non-QuestKitError throws into a network_error QuestKitError", async () => {
    const client = makeFakeClient({
      getCampaign: jest.fn().mockRejectedValue(new Error("kaboom")),
    });
    const { result } = renderHook(() => useCampaign("c1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(QuestKitError);
    expect(result.current.error?.code).toBe("network_error");
  });

  it("refetches when id changes", async () => {
    const c2: Campaign = { ...campaign1, id: "c2" };
    const getCampaign = jest
      .fn()
      .mockResolvedValueOnce({ campaign: campaign1 })
      .mockResolvedValueOnce({ campaign: c2 });
    const client = makeFakeClient({ getCampaign });
    const { result, rerender } = renderHook(({ id }) => useCampaign(id), {
      wrapper: wrapperWith(client),
      initialProps: { id: "c1" },
    });
    await waitFor(() =>
      expect(
        (result.current.data as CampaignDetail | undefined)?.campaign.id,
      ).toBe("c1"),
    );
    rerender({ id: "c2" });
    await waitFor(() =>
      expect(
        (result.current.data as CampaignDetail | undefined)?.campaign.id,
      ).toBe("c2"),
    );
    expect(getCampaign).toHaveBeenCalledWith("c1");
    expect(getCampaign).toHaveBeenCalledWith("c2");
  });

  it("refetch() re-invokes the SDK", async () => {
    const getCampaign = jest
      .fn()
      .mockResolvedValueOnce({ campaign: campaign1 })
      .mockResolvedValueOnce({
        campaign: { ...campaign1, title: "Updated" },
      });
    const client = makeFakeClient({ getCampaign });
    const { result } = renderHook(() => useCampaign("c1"), {
      wrapper: wrapperWith(client),
    });
    await waitFor(() =>
      expect(
        (result.current.data as CampaignDetail | undefined)?.campaign.title,
      ).toBe("Summer"),
    );
    await act(async () => {
      await result.current.refetch();
    });
    expect(
      (result.current.data as CampaignDetail | undefined)?.campaign.title,
    ).toBe("Updated");
    expect(getCampaign).toHaveBeenCalledTimes(2);
  });
});
