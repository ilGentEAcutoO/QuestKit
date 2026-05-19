import type { Balance } from "./balance";
import type { MissionProgress } from "./mission";
import type { Reward } from "./reward";

export type SDKUpdate =
  | { type: "mission.progress"; data: MissionProgress }
  | { type: "mission.completed"; data: MissionProgress }
  | { type: "balance.changed"; data: Balance }
  | {
      type: "reward.granted";
      data: { userId: string; reward: Reward; missionId: string };
    }
  | {
      type: "recommendation";
      data: { userId: string; missionIds: string[]; reason: string };
    };
