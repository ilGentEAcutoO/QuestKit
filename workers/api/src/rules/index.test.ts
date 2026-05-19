import type { Event, Mission, MissionProgress } from "@questkit/types";
/**
 * index.ts (orchestrator) integration tests — written FIRST per TDD discipline.
 *
 * These run inside the workerd test runtime; `env.DB` is a miniflare-backed D1
 * with migrations applied (see test/setup.ts). The orchestrator is the only
 * piece of the rule engine that touches I/O — pure-fn tests for window/filter/
 * evaluator live in their respective .test.ts files.
 *
 * We seed dedicated users to keep this suite hermetic from the migration's
 * sample-data seed (which only creates campaigns + missions, not users or
 * progress rows).
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ensureUser, getMission, getProgress } from "../db/schema";
import { evaluateEvent } from "./index";

/** Pull a real mission row out of D1 (the migration seed loaded these). */
async function loadMission(id: string): Promise<Mission> {
  const m = await getMission(env.DB, id);
  if (!m) throw new Error(`fixture mission ${id} not found in seeded D1`);
  return m;
}

function makeEvent(userId: string, overrides: Partial<Event> = {}): Event {
  return {
    userId,
    name: "purchase.completed",
    payload: {},
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("evaluateEvent — orchestrator", () => {
  it("matches a daily-3-purchases mission and returns the updated progress row", async () => {
    const userId = "u_orch_test_daily_match";
    await ensureUser(env.DB, userId);
    const m1 = await loadMission("mis_ecom_daily_purchase_3");

    const event = makeEvent(userId, { name: "purchase.completed" });
    const updates = await evaluateEvent(env.DB, event, [m1]);

    expect(updates).toHaveLength(1);
    const u = updates[0]!;
    expect(u.userId).toBe(userId);
    expect(u.missionId).toBe(m1.id);
    expect(u.status).toBe("active");
    expect(u.currentCount).toBe(1);
    expect(u.targetCount).toBe(3);

    // The row is persisted in D1.
    const persisted = await getProgress(env.DB, userId, m1.id);
    expect(persisted?.currentCount).toBe(1);
    expect(persisted?.status).toBe("active");
  });

  it("returns empty array when no missions match (wrong event name)", async () => {
    const userId = "u_orch_test_no_match";
    await ensureUser(env.DB, userId);
    const m1 = await loadMission("mis_ecom_daily_purchase_3");

    const event = makeEvent(userId, { name: "video.watched" });
    const updates = await evaluateEvent(env.DB, event, [m1]);
    expect(updates).toHaveLength(0);
  });

  it("returns empty array when filter fails", async () => {
    const userId = "u_orch_test_filter_fail";
    await ensureUser(env.DB, userId);
    const m2 = await loadMission("mis_ecom_electronics_50");

    // Wrong category — won't match the eq:'electronics' filter.
    const event = makeEvent(userId, {
      payload: { amount: 1000, category: "books" },
    });
    const updates = await evaluateEvent(env.DB, event, [m2]);
    expect(updates).toHaveLength(0);
  });

  it("evaluates multiple candidate missions in one call (mixed match/no-match)", async () => {
    const userId = "u_orch_test_multi";
    await ensureUser(env.DB, userId);
    const m1 = await loadMission("mis_ecom_daily_purchase_3");
    const m2 = await loadMission("mis_ecom_electronics_50");
    const m3 = await loadMission("mis_ecom_variety_week");
    // Streaming missions — different eventName, won't match.
    const m4 = await loadMission("mis_stream_daily_watch_1");
    const m5 = await loadMission("mis_stream_documentary_3");

    // $99 electronics — matches M1 (no filter), M2 (gte+eq), M3 fails (electronics not in books/games/toys).
    const event = makeEvent(userId, {
      name: "purchase.completed",
      payload: { amount: 99, category: "electronics" },
    });
    const updates = await evaluateEvent(env.DB, event, [m1, m2, m3, m4, m5]);

    const ids = updates.map((u) => u.missionId).sort();
    expect(ids).toEqual([m1.id, m2.id].sort());

    // M2 (count=1) should be completed.
    const u2 = updates.find((u) => u.missionId === m2.id);
    expect(u2?.status).toBe("completed");
    // M1 (count=3) should be active at 1/3.
    const u1 = updates.find((u) => u.missionId === m1.id);
    expect(u1?.status).toBe("active");
    expect(u1?.currentCount).toBe(1);
  });

  it("increments existing progress on repeat events (same window)", async () => {
    const userId = "u_orch_test_increment";
    await ensureUser(env.DB, userId);
    const m1 = await loadMission("mis_ecom_daily_purchase_3");

    // Fire 3 events back-to-back (with explicit identical-window timestamps).
    // Use the same `now` value for the orchestrator so each call sees a
    // consistent window.
    const now = Date.now();
    const e1 = makeEvent(userId, { timestamp: now });
    const e2 = makeEvent(userId, { timestamp: now });
    const e3 = makeEvent(userId, { timestamp: now });

    const u1 = await evaluateEvent(env.DB, e1, [m1]);
    const u2 = await evaluateEvent(env.DB, e2, [m1]);
    const u3 = await evaluateEvent(env.DB, e3, [m1]);

    expect(u1[0]?.currentCount).toBe(1);
    expect(u1[0]?.status).toBe("active");
    expect(u2[0]?.currentCount).toBe(2);
    expect(u2[0]?.status).toBe("active");
    expect(u3[0]?.currentCount).toBe(3);
    expect(u3[0]?.status).toBe("completed");
  });

  it("returns empty array when candidateMissions is empty", async () => {
    const userId = "u_orch_test_empty";
    await ensureUser(env.DB, userId);
    const event = makeEvent(userId);
    const updates: MissionProgress[] = await evaluateEvent(env.DB, event, []);
    expect(updates).toEqual([]);
  });

  it("respects event.userId — progress is keyed to the event's user", async () => {
    const userA = "u_orch_test_user_a";
    const userB = "u_orch_test_user_b";
    await ensureUser(env.DB, userA);
    await ensureUser(env.DB, userB);
    const m1 = await loadMission("mis_ecom_daily_purchase_3");

    const eventForA = makeEvent(userA);
    const updates = await evaluateEvent(env.DB, eventForA, [m1]);
    expect(updates[0]?.userId).toBe(userA);

    // userB should not have a progress row.
    const userBProgress = await getProgress(env.DB, userB, m1.id);
    expect(userBProgress).toBeNull();
  });
});
