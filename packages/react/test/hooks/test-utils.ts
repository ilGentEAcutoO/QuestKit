import type {
  CampaignDetail,
  FireEventInput,
  FireEventResult,
  MissionsListOpts,
  MissionsListResponse,
  RecommendationsResult,
} from "@questkit/core";
/**
 * Shared test utilities for the hook tests.
 *
 * `makeFakeClient` returns a duck-typed stand-in for QuestKitClient with all
 * methods stubbed to never-resolving promises by default. Tests override
 * just the methods they exercise. The provider is given this object via
 * its `client` prop (a test-only escape hatch documented in provider.tsx).
 *
 * We keep the surface deliberately narrow — only the methods the hooks
 * actually call. If a hook starts calling a new method, add it here too.
 */
import type {
  Balance,
  Campaign,
  Mission,
  MissionProgress,
  SDKUpdate,
} from "@questkit/types";

/**
 * The subset of QuestKitClient methods the hooks call.
 *
 * Each is a `jest.Mock` so tests can assert call counts / args without
 * polluting the call sites with cast noise.
 */
export interface FakeClient {
  getMissions: jest.Mock<Promise<MissionsListResponse>, [MissionsListOpts?]>;
  getMission: jest.Mock<
    Promise<{ mission: Mission; progress: MissionProgress | null }>,
    [string]
  >;
  getBalance: jest.Mock<Promise<Balance | null>, [string]>;
  getBalances: jest.Mock<Promise<Balance[]>, []>;
  getCampaign: jest.Mock<Promise<CampaignDetail>, [string]>;
  getCampaigns: jest.Mock<Promise<Campaign[]>, []>;
  fireEvent: jest.Mock<Promise<FireEventResult>, [FireEventInput]>;
  getRecommendations: jest.Mock<Promise<RecommendationsResult>, []>;
  getUserId: jest.Mock<Promise<string>, []>;
  subscribe: jest.Mock<() => void, [(u: SDKUpdate) => void]>;
  destroy: jest.Mock<void, []>;
}

/**
 * Build a FakeClient with all methods stubbed. Pass overrides to opt into
 * specific behaviour per test.
 *
 * Defaults:
 *   - All read methods reject with "not stubbed" so tests fail loudly if a
 *     hook calls something we didn't mock. Tests that DO need the call
 *     pass their own jest.fn().
 *   - `subscribe` returns a noop unsubscribe (sufficient for non-SSE tests).
 *   - `destroy` is a noop.
 */
export function makeFakeClient(
  overrides: Partial<FakeClient> = {},
): FakeClient {
  return {
    getMissions: jest
      .fn()
      .mockRejectedValue(new Error("getMissions not stubbed")),
    getMission: jest
      .fn()
      .mockRejectedValue(new Error("getMission not stubbed")),
    getBalance: jest
      .fn()
      .mockRejectedValue(new Error("getBalance not stubbed")),
    getBalances: jest
      .fn()
      .mockRejectedValue(new Error("getBalances not stubbed")),
    getCampaign: jest
      .fn()
      .mockRejectedValue(new Error("getCampaign not stubbed")),
    getCampaigns: jest
      .fn()
      .mockRejectedValue(new Error("getCampaigns not stubbed")),
    fireEvent: jest.fn().mockRejectedValue(new Error("fireEvent not stubbed")),
    getRecommendations: jest
      .fn()
      .mockRejectedValue(new Error("getRecommendations not stubbed")),
    getUserId: jest.fn().mockRejectedValue(new Error("getUserId not stubbed")),
    subscribe: jest.fn().mockReturnValue(() => {}),
    destroy: jest.fn(),
    ...overrides,
  };
}
