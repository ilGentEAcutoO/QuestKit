/**
 * filter.ts unit tests — written FIRST per TDD discipline (TASK-009).
 *
 * Exercises every FilterClause variant from @questkit/types:
 *   - eq   — deep equality (structural for arrays/objects via JSON.stringify)
 *   - gte  — numeric ≥ (no string coercion)
 *   - lte  — numeric ≤
 *   - gt   — numeric >
 *   - lt   — numeric <
 *   - in   — membership using the same equality rule as eq
 *
 * The composite `matchesFilter(filterObj, payload)` is logical AND across all
 * keys: every (key, clause) must match. Missing payload field → false.
 */
import type { FilterClause } from "@questkit/types";
import { describe, expect, it } from "vitest";
import { matchesClause, matchesFilter } from "./filter";

describe("matchesClause — eq", () => {
  it("matches primitive equality (string, number, boolean, null)", () => {
    expect(matchesClause({ eq: "electronics" }, "electronics")).toBe(true);
    expect(matchesClause({ eq: 42 }, 42)).toBe(true);
    expect(matchesClause({ eq: true }, true)).toBe(true);
    expect(matchesClause({ eq: null }, null)).toBe(true);
  });

  it("does not match across types (1 !== '1', null !== undefined)", () => {
    expect(matchesClause({ eq: 1 }, "1")).toBe(false);
    expect(matchesClause({ eq: "1" }, 1)).toBe(false);
    expect(matchesClause({ eq: null }, undefined)).toBe(false);
    expect(matchesClause({ eq: false }, 0)).toBe(false);
  });

  it("matches structurally for arrays + objects (deep-equal via JSON)", () => {
    expect(matchesClause({ eq: [1, 2, 3] }, [1, 2, 3])).toBe(true);
    expect(matchesClause({ eq: { a: 1 } }, { a: 1 })).toBe(true);
    expect(matchesClause({ eq: [1, 2] }, [2, 1])).toBe(false);
    expect(matchesClause({ eq: { a: 1 } }, { a: 1, b: 2 })).toBe(false);
  });
});

describe("matchesClause — gte / lte / gt / lt", () => {
  it("gte: numeric ≥ semantics", () => {
    expect(matchesClause({ gte: 50 }, 50)).toBe(true);
    expect(matchesClause({ gte: 50 }, 49.999)).toBe(false);
    expect(matchesClause({ gte: 50 }, 1000)).toBe(true);
  });

  it("lte: numeric ≤ semantics", () => {
    expect(matchesClause({ lte: 50 }, 50)).toBe(true);
    expect(matchesClause({ lte: 50 }, 50.001)).toBe(false);
    expect(matchesClause({ lte: 50 }, -10)).toBe(true);
  });

  it("gt: strict >", () => {
    expect(matchesClause({ gt: 50 }, 50)).toBe(false);
    expect(matchesClause({ gt: 50 }, 50.0001)).toBe(true);
  });

  it("lt: strict <", () => {
    expect(matchesClause({ lt: 50 }, 50)).toBe(false);
    expect(matchesClause({ lt: 50 }, 49.9999)).toBe(true);
  });

  it("returns false when value is not a number (no string coercion)", () => {
    expect(matchesClause({ gte: 50 }, "50")).toBe(false);
    expect(matchesClause({ lte: 50 }, "10")).toBe(false);
    expect(matchesClause({ gt: 0 }, true)).toBe(false);
    expect(matchesClause({ lt: 100 }, null)).toBe(false);
    expect(matchesClause({ gte: 0 }, undefined)).toBe(false);
  });

  it("rejects NaN as a value (NaN compared with anything is false)", () => {
    expect(matchesClause({ gte: 0 }, Number.NaN)).toBe(false);
    expect(matchesClause({ lte: 0 }, Number.NaN)).toBe(false);
  });
});

describe("matchesClause — in", () => {
  it("matches when value appears in the array (primitives)", () => {
    expect(matchesClause({ in: ["books", "games", "toys"] }, "books")).toBe(
      true,
    );
    expect(matchesClause({ in: ["books", "games", "toys"] }, "toys")).toBe(
      true,
    );
    expect(matchesClause({ in: [1, 2, 3] }, 2)).toBe(true);
  });

  it("does not match when value is absent", () => {
    expect(matchesClause({ in: ["books", "games"] }, "movies")).toBe(false);
    expect(matchesClause({ in: [1, 2, 3] }, 4)).toBe(false);
    expect(matchesClause({ in: [] }, "anything")).toBe(false);
  });

  it("uses structural equality for arrays/objects within `in`", () => {
    expect(matchesClause({ in: [{ a: 1 }, { a: 2 }] }, { a: 1 })).toBe(true);
    expect(matchesClause({ in: [{ a: 1 }] }, { a: 2 })).toBe(false);
  });
});

describe("matchesClause — defensive", () => {
  it("returns false for unknown / malformed clause shapes", () => {
    // Cast through unknown so we can poke at impossible shapes.
    expect(matchesClause({} as unknown as FilterClause, 1)).toBe(false);
    expect(matchesClause({ foo: 1 } as unknown as FilterClause, 1)).toBe(false);
    expect(matchesClause(null as unknown as FilterClause, 1)).toBe(false);
    expect(matchesClause(undefined as unknown as FilterClause, 1)).toBe(false);
  });

  it("treats non-array `in` defensively as no match", () => {
    expect(
      matchesClause({ in: "books" } as unknown as FilterClause, "books"),
    ).toBe(false);
  });
});

describe("matchesFilter — composite AND", () => {
  it("returns true when every key matches", () => {
    expect(
      matchesFilter(
        { amount: { gte: 50 }, category: { eq: "electronics" } },
        { amount: 99.99, category: "electronics" },
      ),
    ).toBe(true);
  });

  it("returns false when any single key fails (gte half of a composite)", () => {
    expect(
      matchesFilter(
        { amount: { gte: 50 }, category: { eq: "electronics" } },
        { amount: 49, category: "electronics" },
      ),
    ).toBe(false);
  });

  it("returns false when any single key fails (eq half of a composite)", () => {
    expect(
      matchesFilter(
        { amount: { gte: 50 }, category: { eq: "electronics" } },
        { amount: 1000, category: "books" },
      ),
    ).toBe(false);
  });

  it("returns false when payload field is missing", () => {
    expect(
      matchesFilter({ amount: { gte: 50 } }, { category: "electronics" }),
    ).toBe(false);
  });

  it("returns true for an undefined filter (zero constraints)", () => {
    expect(matchesFilter(undefined, { anything: 1 })).toBe(true);
  });

  it("returns true for an empty filter object (zero constraints)", () => {
    expect(matchesFilter({}, { anything: 1 })).toBe(true);
  });

  it("undefined filter against undefined-ish payload: still true (no constraints)", () => {
    expect(matchesFilter(undefined, {})).toBe(true);
  });

  it("non-empty filter against empty payload: false (missing fields)", () => {
    expect(matchesFilter({ a: { eq: 1 } }, {})).toBe(false);
  });

  it("handles the M3 seed's `in` filter (variety pack: books/games/toys)", () => {
    const filter = { category: { in: ["books", "games", "toys"] } };
    expect(matchesFilter(filter, { category: "books" })).toBe(true);
    expect(matchesFilter(filter, { category: "games" })).toBe(true);
    expect(matchesFilter(filter, { category: "movies" })).toBe(false);
  });
});
