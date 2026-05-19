/**
 * evaluator.ts unit tests — written FIRST per TDD discipline (TASK-009).
 *
 * The evaluator is the pure-fn core of the rule engine: given an event +
 * a mission + the user's current progress on that mission, compute the new
 * state. All D1 access lives in the orchestrator (index.ts) — this file is
 * deterministic.
 *
 * Seed missions referenced here mirror migrations/0002_seed_sample_data.sql
 * so the "happy paths" are realistic.
 */
import type { Event, Mission, MissionProgress } from "@questkit/types";
import { describe, expect, it } from "vitest";
import { evaluate } from "./evaluator";

// -----------------------------------------------------------------------------
// Test fixtures
// -----------------------------------------------------------------------------

const USER = "u_eval_test_1";

/** Helper: build a UTC ms timestamp. */
function utc(
  y: number,
  mo: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0,
  ms = 0,
): number {
  return Date.UTC(y, mo - 1, d, h, mi, s, ms);
}

/** Reference "now" for all tests: 2026-05-19 12:00 UTC (a Tuesday). */
const NOW = utc(2026, 5, 19, 12, 0, 0, 0);
const DAY_MS = 86_400_000;

/** Mission M1: daily, 3 purchases, no filter (coin reward). */
const M1_DAILY_3_PURCHASES: Mission = {
  id: "mis_ecom_daily_purchase_3",
  title: "Triple Treat",
  description: "Make 3 purchases today",
  criteria: { eventName: "purchase.completed", count: 3, window: "daily" },
  reward: { kind: "currency", currency: "coin", amount: 100 },
};

/** Mission M2: lifetime, single $50+ electronics purchase. */
const M2_ELECTRONICS_50: Mission = {
  id: "mis_ecom_electronics_50",
  title: "Power User",
  description: "Spend $50+ on a single electronics purchase",
  criteria: {
    eventName: "purchase.completed",
    count: 1,
    window: "lifetime",
    filter: { amount: { gte: 50 }, category: { eq: "electronics" } },
  },
  reward: { kind: "badge", badgeId: "power_user" },
};

/** Mission M3: weekly, 5 purchases across books/games/toys (in filter). */
const M3_VARIETY_5: Mission = {
  id: "mis_ecom_variety_week",
  title: "Variety Pack",
  description: "Make 5 purchases this week across books, games, or toys",
  criteria: {
    eventName: "purchase.completed",
    count: 5,
    window: "weekly",
    filter: { category: { in: ["books", "games", "toys"] } },
  },
  reward: { kind: "currency", currency: "gem", amount: 5 },
};

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    userId: USER,
    name: "purchase.completed",
    payload: {},
    timestamp: NOW,
    ...overrides,
  };
}

// -----------------------------------------------------------------------------
// Match — happy paths
// -----------------------------------------------------------------------------

describe("evaluate — match (no filter)", () => {
  it("first daily purchase (M1) → locked → active, count 1/3", () => {
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, null, NOW);
    expect(result.matched).toBe(true);
    expect(result.newCurrentCount).toBe(1);
    expect(result.status).toBe("active");
    expect(result.updatedProgress).toEqual<MissionProgress>({
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "active",
      progress: 1 / 3,
      currentCount: 1,
      targetCount: 3,
      updatedAt: NOW,
    });
  });

  it("third daily purchase (M1) same day → active → completed", () => {
    const existing: MissionProgress = {
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "active",
      progress: 2 / 3,
      currentCount: 2,
      targetCount: 3,
      // Earlier today — within the same daily window as NOW.
      updatedAt: utc(2026, 5, 19, 9, 0, 0, 0),
    };
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, existing, NOW);
    expect(result.matched).toBe(true);
    expect(result.newCurrentCount).toBe(3);
    expect(result.status).toBe("completed");
    expect(result.updatedProgress?.progress).toBe(1);
  });
});

describe("evaluate — match with composite filter", () => {
  it("$99 electronics (M2) → completed immediately (count=1)", () => {
    const event = makeEvent({
      payload: { amount: 99, category: "electronics" },
    });
    const result = evaluate(event, M2_ELECTRONICS_50, null, NOW);
    expect(result.matched).toBe(true);
    expect(result.newCurrentCount).toBe(1);
    expect(result.status).toBe("completed");
    expect(result.updatedProgress?.progress).toBe(1);
  });

  it("$50 electronics (M2) on the boundary → matches (gte)", () => {
    const event = makeEvent({
      payload: { amount: 50, category: "electronics" },
    });
    const result = evaluate(event, M2_ELECTRONICS_50, null, NOW);
    expect(result.matched).toBe(true);
  });

  it("$200 books (M2) — fails category eq", () => {
    const event = makeEvent({ payload: { amount: 200, category: "books" } });
    const result = evaluate(event, M2_ELECTRONICS_50, null, NOW);
    expect(result.matched).toBe(false);
    expect(result.updatedProgress).toBeNull();
  });

  it("$40 electronics (M2) — fails amount gte", () => {
    const event = makeEvent({
      payload: { amount: 40, category: "electronics" },
    });
    const result = evaluate(event, M2_ELECTRONICS_50, null, NOW);
    expect(result.matched).toBe(false);
  });
});

describe("evaluate — match with `in` filter", () => {
  it("weekly games purchase (M3) — first match goes locked → active", () => {
    const event = makeEvent({ payload: { category: "games" } });
    const result = evaluate(event, M3_VARIETY_5, null, NOW);
    expect(result.matched).toBe(true);
    expect(result.newCurrentCount).toBe(1);
    expect(result.status).toBe("active");
  });

  it("weekly movies purchase (M3) — category not in list, no match", () => {
    const event = makeEvent({ payload: { category: "movies" } });
    const result = evaluate(event, M3_VARIETY_5, null, NOW);
    expect(result.matched).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// No match — coarse predicates
// -----------------------------------------------------------------------------

describe("evaluate — no match (mismatched event name)", () => {
  it("ignores video.watched events for a purchase mission", () => {
    const event = makeEvent({ name: "video.watched" });
    const result = evaluate(event, M1_DAILY_3_PURCHASES, null, NOW);
    expect(result.matched).toBe(false);
    expect(result.updatedProgress).toBeNull();
  });
});

describe("evaluate — no match (expired mission)", () => {
  it("returns no-match when event timestamp is after mission.expiresAt", () => {
    const m: Mission = {
      ...M1_DAILY_3_PURCHASES,
      expiresAt: NOW - 1000,
    };
    const event = makeEvent({ timestamp: NOW });
    const result = evaluate(event, m, null, NOW);
    expect(result.matched).toBe(false);
  });

  it("still matches when event is exactly at expiresAt", () => {
    const m: Mission = {
      ...M1_DAILY_3_PURCHASES,
      expiresAt: NOW,
    };
    const event = makeEvent({ timestamp: NOW });
    const result = evaluate(event, m, null, NOW);
    expect(result.matched).toBe(true);
  });
});

describe("evaluate — no match (event outside current window)", () => {
  it("daily: event from yesterday relative to NOW → no match (no backfill)", () => {
    const yesterday = utc(2026, 5, 18, 15, 0, 0, 0);
    const event = makeEvent({ timestamp: yesterday });
    const result = evaluate(event, M1_DAILY_3_PURCHASES, null, NOW);
    expect(result.matched).toBe(false);
  });

  it("weekly: event from prior ISO week → no match", () => {
    // NOW is Tue 2026-05-19, in week 2026-05-18..2026-05-25.
    // Use a timestamp from 2026-05-17 (last Sunday → prior week).
    const priorWeek = utc(2026, 5, 17, 12, 0, 0, 0);
    const event = makeEvent({ timestamp: priorWeek });
    const result = evaluate(event, M3_VARIETY_5, null, NOW);
    expect(result.matched).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// Window-reset behaviour
// -----------------------------------------------------------------------------

describe("evaluate — window reset on stale progress", () => {
  it("daily: existing progress from yesterday is reset to 0, then incremented", () => {
    const yesterday = utc(2026, 5, 18, 10, 0, 0, 0);
    const stale: MissionProgress = {
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "active",
      progress: 2 / 3,
      currentCount: 2,
      targetCount: 3,
      updatedAt: yesterday,
    };
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, stale, NOW);
    expect(result.matched).toBe(true);
    // Counter reset: starts from 0, this event makes it 1.
    expect(result.newCurrentCount).toBe(1);
    expect(result.status).toBe("active");
  });

  it("weekly: existing progress from prior week is reset to 0", () => {
    const lastWeek = utc(2026, 5, 11, 12, 0, 0, 0); // Mon prior week
    const stale: MissionProgress = {
      userId: USER,
      missionId: M3_VARIETY_5.id,
      status: "active",
      progress: 4 / 5,
      currentCount: 4,
      targetCount: 5,
      updatedAt: lastWeek,
    };
    const event = makeEvent({ payload: { category: "books" } });
    const result = evaluate(event, M3_VARIETY_5, stale, NOW);
    expect(result.matched).toBe(true);
    expect(result.newCurrentCount).toBe(1);
    expect(result.status).toBe("active");
  });

  it("lifetime: existing progress is never reset (no prior window exists)", () => {
    // Even progress from 5 years ago counts toward lifetime targets.
    const longAgo = utc(2021, 1, 1, 0, 0, 0, 0);
    const stale: MissionProgress = {
      userId: USER,
      missionId: M2_ELECTRONICS_50.id,
      status: "active",
      progress: 0,
      currentCount: 0,
      targetCount: 1,
      updatedAt: longAgo,
    };
    const event = makeEvent({
      payload: { amount: 99, category: "electronics" },
    });
    const result = evaluate(event, M2_ELECTRONICS_50, stale, NOW);
    expect(result.matched).toBe(true);
    expect(result.newCurrentCount).toBe(1);
    expect(result.status).toBe("completed");
  });
});

// -----------------------------------------------------------------------------
// Status transitions
// -----------------------------------------------------------------------------

describe("evaluate — status transitions", () => {
  it("first match: locked → active (counter 1 < target)", () => {
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, null, NOW);
    expect(result.status).toBe("active");
  });

  it("final increment: active → completed (counter == target)", () => {
    const existing: MissionProgress = {
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "active",
      progress: 2 / 3,
      currentCount: 2,
      targetCount: 3,
      updatedAt: NOW - 1_000,
    };
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, existing, NOW);
    expect(result.status).toBe("completed");
  });

  it("over-shoot: count > target still completed (clamped progress=1)", () => {
    // Defensive: even if upstream allows an extra increment past target,
    // progress is clamped to 1 (never > 1).
    const existing: MissionProgress = {
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "completed",
      progress: 1,
      currentCount: 3,
      targetCount: 3,
      updatedAt: NOW - 1_000,
    };
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, existing, NOW);
    expect(result.matched).toBe(true);
    expect(result.newCurrentCount).toBe(4);
    expect(result.status).toBe("completed");
    expect(result.updatedProgress?.progress).toBe(1);
  });
});

// -----------------------------------------------------------------------------
// Claimed-status semantics
// -----------------------------------------------------------------------------

describe("evaluate — claimed status", () => {
  it("daily: claimed in current window → no match (already claimed)", () => {
    const claimed: MissionProgress = {
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "claimed",
      progress: 1,
      currentCount: 3,
      targetCount: 3,
      // Same day as NOW.
      updatedAt: utc(2026, 5, 19, 9, 0, 0, 0),
    };
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, claimed, NOW);
    expect(result.matched).toBe(false);
  });

  it("daily: claimed yesterday → fresh evaluation (window advanced)", () => {
    const claimedYesterday: MissionProgress = {
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "claimed",
      progress: 1,
      currentCount: 3,
      targetCount: 3,
      updatedAt: utc(2026, 5, 18, 18, 0, 0, 0),
    };
    const result = evaluate(
      makeEvent(),
      M1_DAILY_3_PURCHASES,
      claimedYesterday,
      NOW,
    );
    expect(result.matched).toBe(true);
    // Counter reset to 0, incremented to 1.
    expect(result.newCurrentCount).toBe(1);
    expect(result.status).toBe("active");
  });

  it("lifetime: claimed → no match (window never advances)", () => {
    const claimed: MissionProgress = {
      userId: USER,
      missionId: M2_ELECTRONICS_50.id,
      status: "claimed",
      progress: 1,
      currentCount: 1,
      targetCount: 1,
      updatedAt: NOW - DAY_MS * 365,
    };
    const event = makeEvent({
      payload: { amount: 99, category: "electronics" },
    });
    const result = evaluate(event, M2_ELECTRONICS_50, claimed, NOW);
    expect(result.matched).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// updatedProgress shape
// -----------------------------------------------------------------------------

describe("evaluate — updatedProgress shape", () => {
  it("populates every field with current data + nowMs", () => {
    const result = evaluate(makeEvent(), M1_DAILY_3_PURCHASES, null, NOW);
    expect(result.updatedProgress).toEqual<MissionProgress>({
      userId: USER,
      missionId: M1_DAILY_3_PURCHASES.id,
      status: "active",
      progress: 1 / 3,
      currentCount: 1,
      targetCount: 3,
      updatedAt: NOW,
    });
  });

  it("returns null updatedProgress on no-match", () => {
    const result = evaluate(
      makeEvent({ name: "wrong.event" }),
      M1_DAILY_3_PURCHASES,
      null,
      NOW,
    );
    expect(result.updatedProgress).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Window default (criteria.window is optional)
// -----------------------------------------------------------------------------

describe("evaluate — defaults", () => {
  it("treats a missing criteria.window as 'lifetime'", () => {
    const noWindow: Mission = {
      ...M1_DAILY_3_PURCHASES,
      criteria: { eventName: "purchase.completed", count: 3 },
    };
    // A long-past event still counts because lifetime spans [0, +Infinity).
    const event = makeEvent({ timestamp: utc(2020, 1, 1, 0, 0, 0, 0) });
    const result = evaluate(event, noWindow, null, NOW);
    expect(result.matched).toBe(true);
  });
});
