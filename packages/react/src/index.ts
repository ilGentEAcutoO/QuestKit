/**
 * @questkit/react public entry — React widget library and hooks.
 *
 * Consumers should `import '@questkit/react/styles.css'` once at app boot
 * to register the Tailwind v4 `@theme` tokens.
 *
 * Provider + 5 hooks land in TASK-015; the widget components land in
 * TASK-016. TASK-014 only provided the package skeleton and theme.
 */

// TASK-016 components
export { CampaignBanner } from "./components/CampaignBanner";
export type { CampaignBannerProps } from "./components/CampaignBanner";

export { CoinBalance } from "./components/CoinBalance";
export type { CoinBalanceProps } from "./components/CoinBalance";
export { MissionCard } from "./components/MissionCard";
export type { MissionCardProps } from "./components/MissionCard";
export { MissionList } from "./components/MissionList";
export type { MissionListProps } from "./components/MissionList";
export { ProgressBar } from "./components/ProgressBar";
export type { ProgressBarProps } from "./components/ProgressBar";

// TASK-017 components — AI recommendations
// Placed here (between ProgressBar and RewardClaimToast) so the
// perfectionist/sort-exports rule is satisfied: "Recommended" < "Reward".
export { RecommendedMissions } from "./components/RecommendedMissions";
export type { RecommendedMissionsProps } from "./components/RecommendedMissions";
// TASK-016 components (continued)
export {
  RewardClaimToastHost,
  useRewardClaimToast,
} from "./components/RewardClaimToast";
export type {
  RewardClaimToastHostProps,
  UseRewardClaimToastResult,
} from "./components/RewardClaimToast";
// TASK-018 components — mini-games
export { ScratchCard } from "./components/ScratchCard";
export type { ScratchCardProps } from "./components/ScratchCard";
export { SpinWheel } from "./components/SpinWheel";
export type { SpinWheelProps, SpinWheelSlice } from "./components/SpinWheel";
export type { HookState } from "./hooks/types";
// Hooks
export { useBalance } from "./hooks/useBalance";

export { useCampaign } from "./hooks/useCampaign";
export { useEvent } from "./hooks/useEvent";

export type { UseEventResult } from "./hooks/useEvent";
export { useMission } from "./hooks/useMission";

export type { UseMissionData } from "./hooks/useMission";
export { useMissions } from "./hooks/useMissions";
export { useRecommendations } from "./hooks/useRecommendations";
export { QuestKitProvider, useQuestKit } from "./provider";
export type { QuestKitProviderProps } from "./provider";
