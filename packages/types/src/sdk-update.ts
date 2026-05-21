import type { Balance } from "./balance";
import type { MissionProgress } from "./mission";
import type { Reward } from "./reward";

export type SDKUpdate =
  | { type: "mission.progress"; data: MissionProgress }
  | { type: "mission.completed"; data: MissionProgress }
  // Phase 9 / TASK-001 (Cluster C1) — dedicated terminal claim event.
  // Emitted by `POST /v1/missions/:id/claim` AFTER the D1 commit + BEFORE
  // the existing `reward.granted` / `balance.changed` broadcasts, so the
  // UI flips the card to "Claimed" first and the reward toast lands
  // immediately after on a button that's already disabled. Mirrors
  // `mission.completed`'s data shape (post-claim `MissionProgress`) so
  // consumers can route both through the same terminal-overwrite branch.
  | { type: "mission.claimed"; data: MissionProgress }
  | { type: "balance.changed"; data: Balance }
  | {
      type: "reward.granted";
      data: { userId: string; reward: Reward; missionId: string };
    }
  | {
      type: "recommendation";
      data: { userId: string; missionIds: string[]; reason: string };
    };
