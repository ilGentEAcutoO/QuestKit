/**
 * @questkit/core public entry — the SDK surface exposed to consumers.
 *
 * Deliberate omissions:
 *   - Domain types (Mission, Balance, etc.) are NOT re-exported. Consumers
 *     import them directly from `@questkit/types`. This keeps the SDK's
 *     bundle independent of the type set's evolution and makes the public
 *     contract a single, narrow class + a single error type.
 *   - EventQueue / SSEClient / PollingClient internals are NOT exported.
 *     They are pure implementation details; if a consumer needs to wire
 *     them differently, the QuestKitClient constructor accepts overrides.
 */

export { QuestKitClient } from "./client";
export type {
  CampaignDetail,
  CampaignsListOpts,
  ClaimResult,
  FireEventInput,
  FireEventResult,
  MissionsListOpts,
  MissionsListResponse,
  QuestKitConfig,
  RecommendationsResult,
} from "./client";
export { QuestKitError } from "./errors";
// Surfaced so out-of-band reset flows (e.g. the demo's DevTools "Reset user")
// can wipe the persisted event queue alongside their own localStorage keys.
// See event-queue.ts for the rationale.
export { EVENT_QUEUE_STORAGE_KEY } from "./event-queue";
