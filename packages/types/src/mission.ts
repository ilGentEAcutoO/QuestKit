import type { Reward } from "./reward";

export interface Mission {
  id: string;
  title: string;
  description: string;
  criteria: MissionCriteria;
  reward: Reward;
  campaignId?: string;
  expiresAt?: number;
  iconUrl?: string;
}

export interface MissionCriteria {
  eventName: string;
  count: number;
  window?: "daily" | "weekly" | "lifetime";
  filter?: Record<string, FilterClause>;
}

export type FilterClause =
  | { eq: unknown }
  | { gte: number }
  | { lte: number }
  | { gt: number }
  | { lt: number }
  | { in: unknown[] };

export interface MissionProgress {
  userId: string;
  missionId: string;
  status: "locked" | "active" | "completed" | "claimed";
  progress: number;
  currentCount: number;
  targetCount: number;
  updatedAt: number;
}
