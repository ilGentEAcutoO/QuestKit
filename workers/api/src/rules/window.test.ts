/**
 * window.ts unit tests — written FIRST per TDD discipline (TASK-009).
 *
 * Window arithmetic is UTC-only (per plan §3 amendment A9 — no local-timezone
 * drift, no DST shifts). Daily = UTC calendar day. Weekly = ISO week (Monday
 * 00:00:00.000Z → next Monday 00:00:00.000Z). Lifetime = `[0, +Infinity)`.
 *
 * Each test fixes `refMs` to a literal Unix-ms so the expected bounds are
 * independent of wall-clock and trivially auditable.
 */
import { describe, expect, it } from "vitest";
import { windowBounds } from "./window";

/** Helper: build a UTC-fixed ms from yyyy/mm/dd/hh/mm/ss components. */
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

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

describe("windowBounds (daily)", () => {
  it("returns [00:00:00Z, 24:00:00Z) for a ref exactly at UTC midnight", () => {
    const ref = utc(2026, 5, 19, 0, 0, 0, 0);
    const { startMs, endMs } = windowBounds("daily", ref);
    expect(startMs).toBe(ref);
    expect(endMs).toBe(ref + DAY_MS);
  });

  it("returns the same day's bounds for a ref at 23:59:59.999Z", () => {
    const dayStart = utc(2026, 5, 19, 0, 0, 0, 0);
    const ref = utc(2026, 5, 19, 23, 59, 59, 999);
    const { startMs, endMs } = windowBounds("daily", ref);
    expect(startMs).toBe(dayStart);
    expect(endMs).toBe(dayStart + DAY_MS);
  });

  it("does NOT roll back 24h for a mid-afternoon ref — uses the day containing ref", () => {
    const ref = utc(2026, 5, 19, 15, 30, 0, 0);
    const { startMs, endMs } = windowBounds("daily", ref);
    expect(startMs).toBe(utc(2026, 5, 19, 0, 0, 0, 0));
    expect(endMs).toBe(utc(2026, 5, 20, 0, 0, 0, 0));
  });

  it("anchors to UTC: a ref at 2026-05-19T23:30Z still resolves to 2026-05-19 (no local-tz shift)", () => {
    // If we accidentally used local time on a host in UTC+8, this would
    // resolve to 2026-05-20. We pin to UTC so the result is deterministic.
    const ref = utc(2026, 5, 19, 23, 30, 0, 0);
    const { startMs } = windowBounds("daily", ref);
    expect(startMs).toBe(utc(2026, 5, 19, 0, 0, 0, 0));
  });

  it("handles month boundary — last second of a month maps to that month's last day", () => {
    const ref = utc(2026, 5, 31, 23, 59, 59, 999);
    const { startMs, endMs } = windowBounds("daily", ref);
    expect(startMs).toBe(utc(2026, 5, 31, 0, 0, 0, 0));
    expect(endMs).toBe(utc(2026, 6, 1, 0, 0, 0, 0));
  });
});

describe("windowBounds (weekly — ISO week, Mon→Mon UTC)", () => {
  it("ref on a Monday at 00:00:00.000Z — that Monday starts the new week", () => {
    // 2026-05-18 is a Monday (verified: Date.UTC(2026,4,18).getDay()===1).
    const monday = utc(2026, 5, 18, 0, 0, 0, 0);
    const { startMs, endMs } = windowBounds("weekly", monday);
    expect(startMs).toBe(monday);
    expect(endMs).toBe(monday + WEEK_MS);
  });

  it("ref on a Sunday — returns the week ending Sunday, starting prior Monday", () => {
    // 2026-05-24 is a Sunday. Its ISO week started on 2026-05-18 (Mon)
    // and ends right before 2026-05-25 (next Mon) 00:00:00Z.
    const sunday = utc(2026, 5, 24, 15, 0, 0, 0);
    const { startMs, endMs } = windowBounds("weekly", sunday);
    expect(startMs).toBe(utc(2026, 5, 18, 0, 0, 0, 0));
    expect(endMs).toBe(utc(2026, 5, 25, 0, 0, 0, 0));
  });

  it("ref on a Wednesday — week starts the preceding Monday", () => {
    // 2026-05-20 is a Wednesday. Its ISO week is 2026-05-18..2026-05-25.
    const wed = utc(2026, 5, 20, 10, 0, 0, 0);
    const { startMs, endMs } = windowBounds("weekly", wed);
    expect(startMs).toBe(utc(2026, 5, 18, 0, 0, 0, 0));
    expect(endMs).toBe(utc(2026, 5, 25, 0, 0, 0, 0));
  });

  it("ref on a Sunday at 23:59:59.999Z — still within the prior Mon→Mon week", () => {
    const sundayLast = utc(2026, 5, 24, 23, 59, 59, 999);
    const { startMs, endMs } = windowBounds("weekly", sundayLast);
    expect(startMs).toBe(utc(2026, 5, 18, 0, 0, 0, 0));
    expect(endMs).toBe(utc(2026, 5, 25, 0, 0, 0, 0));
  });

  it("does NOT shift for DST — March 2026 Sunday is a normal Mon→Mon week", () => {
    // Many JS time bugs come from local-tz DST. We pin everything UTC.
    // 2026-03-08 was DST forward in US Eastern. Our bounds must be UTC,
    // not 23h or 25h.
    const ref = utc(2026, 3, 8, 12, 0, 0, 0); // Sunday
    const { startMs, endMs } = windowBounds("weekly", ref);
    expect(endMs - startMs).toBe(WEEK_MS);
    expect(startMs).toBe(utc(2026, 3, 2, 0, 0, 0, 0)); // Mon
    expect(endMs).toBe(utc(2026, 3, 9, 0, 0, 0, 0)); // next Mon
  });

  it("week of 1970-01-01 (Thursday) — ISO week started Mon 1969-12-29", () => {
    const ref = utc(1970, 1, 1, 0, 0, 0, 0); // Thu
    const { startMs, endMs } = windowBounds("weekly", ref);
    // 1969-12-29 UTC midnight = Date.UTC(1969, 11, 29)
    expect(startMs).toBe(Date.UTC(1969, 11, 29, 0, 0, 0, 0));
    expect(endMs).toBe(utc(1970, 1, 5, 0, 0, 0, 0)); // next Monday
    expect(endMs - startMs).toBe(WEEK_MS);
  });
});

describe("windowBounds (lifetime)", () => {
  it("always returns [0, +Infinity) regardless of ref", () => {
    for (const ref of [0, 1, utc(2026, 5, 19, 12, 0, 0, 0), Date.now()]) {
      const { startMs, endMs } = windowBounds("lifetime", ref);
      expect(startMs).toBe(0);
      expect(endMs).toBe(Number.POSITIVE_INFINITY);
    }
  });
});
