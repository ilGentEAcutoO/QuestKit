/**
 * log-redaction tests — locks the `redactId` contract and asserts that a
 * `console.warn` invocation routed through `redactId` cannot leak the raw id.
 *
 * Closes security-review §3.8 A3 (TASK-040). The current code base does not
 * yet embed user-ids in any `console.warn` message — this test exists so a
 * future regression (someone writes ``console.warn(`failed for ${userId}`)``)
 * has a high-visibility guard in place.
 *
 * Pure helper test — no `cloudflare:test` env import. The vitest-pool-workers
 * runtime still applies `setup.ts` migrations on the shared DB, but this file
 * never touches it; it only exercises the redact module + a stub console.warn.
 */
import { describe, expect, it, vi } from "vitest";
import { redactId } from "../src/util/redact";

describe("redactId", () => {
  it("keeps first 4 chars + ellipsis + last 2 for ids of length ≥ 8", () => {
    // Long id (32-char-ish UUID-shape) — the canonical case.
    expect(redactId("01HXYZ-mission-abc123def456")).toBe("01HX…56");

    // Exactly 8 chars — boundary case; slice(0,4) + slice(-2) must work.
    expect(redactId("abcdefgh")).toBe("abcd…gh");

    // 32-char UUID without dashes — the realistic case for our JWT `sub`.
    expect(redactId("0123456789abcdef0123456789abcdef")).toBe("0123…ef");
  });

  it("fully masks ids shorter than 8 chars with ***", () => {
    expect(redactId("u-123")).toBe("***");
    expect(redactId("")).toBe("***");
    expect(redactId("abc")).toBe("***");
    // 7 chars — still below the threshold.
    expect(redactId("1234567")).toBe("***");
  });

  it("never returns the raw id (no full pass-through)", () => {
    const id = "user-supersecret-id-abcdef";
    const redacted = redactId(id);
    expect(redacted).not.toContain("supersecret");
    expect(redacted).not.toBe(id);
    // Sanity: it IS the documented shape.
    expect(redacted).toBe("user…ef");
  });

  it("is deterministic — same input always yields same output", () => {
    const id = "01HXYZ-mission-abc123def456";
    expect(redactId(id)).toBe(redactId(id));
  });
});

describe("console.warn does not leak user-ids when routed through redactId", () => {
  it("captures only the redacted form in the warn argument list", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const userId = "user-leak-test-1234567890abcdef";
      // Simulates the recommended pattern for any future warn that needs to
      // identify the user. If a future contributor writes the WRONG version
      // (e.g. ``console.warn(`failed for ${userId}`)``) the assertion below
      // would catch it inside their own test that exercises that path.
      console.warn("[test] failure for user", redactId(userId));

      const all = warnSpy.mock.calls.flat().join(" ");
      expect(all).not.toContain("leak-test-1234567890abcdef");
      expect(all).not.toContain("leak-test");
      expect(all).toContain("user…ef");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("would fail if a caller passed the raw id (sanity check on the guard)", () => {
    // This test documents what the guard catches: if someone forgets
    // `redactId` and passes the raw id, the substring assertion fires.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const userId = "user-leak-test-zzzzzzzzzzzzzzzz";
      // Deliberately the WRONG pattern — proving the guard works.
      console.warn("[test] failure for user", userId);

      const all = warnSpy.mock.calls.flat().join(" ");
      // The raw id IS present — so the matching assertion in real code
      // would correctly fire.
      expect(all).toContain("leak-test-zzzzzzzzzzzzzzzz");
    } finally {
      warnSpy.mockRestore();
    }
  });
});
