/**
 * hmac.ts unit tests — written FIRST per TDD discipline.
 *
 * `verify` is a pure async function (no `env`, no I/O beyond Web Crypto), so
 * we test it directly rather than via `SELF.fetch`. This sidesteps the L1
 * workerd-isolate boundary discovered in Phase 3 (`vi.mock` does not reach into
 * the worker bundle): pure modules tested as plain JS get full control over
 * inputs and the system clock via the `now` injectable.
 *
 * Signature format we accept:  `t=<unix-seconds>,v1=<hex-sha256>` (Stripe-style).
 * Tolerance defaults to 300 seconds (5 minutes) on either side of `now`.
 */
import { describe, expect, it } from "vitest";
import { verify } from "../src/hmac";

const SECRET = "test_webhook_hmac_secret_do_not_use_in_prod_only_for_vitest";

/**
 * Compute the v1 signature for `${t}.${rawBody}` so tests can construct a
 * valid header without coupling to the implementation. This is the spec — if
 * `verify` doesn't agree with this helper, `verify` is wrong.
 */
async function signSampleHex(rawBody: string, t: number, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${t}.${rawBody}`),
    ),
  );
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

describe("hmac.verify — happy path", () => {
  it("accepts a valid sig within the default tolerance window", async () => {
    const rawBody = JSON.stringify({ id: "evt_1", type: "test.event" });
    const t = 1_700_000_000;
    const hex = await signSampleHex(rawBody, t, SECRET);
    const result = await verify(rawBody, `t=${t},v1=${hex}`, SECRET, {
      now: () => t,
    });
    expect(result).toEqual({ ok: true });
  });

  it("accepts a sig at the exact edge of the tolerance window", async () => {
    const rawBody = "edge_case_body";
    const t = 1_700_000_000;
    const hex = await signSampleHex(rawBody, t, SECRET);
    // now is exactly 300 seconds after t — still inside the inclusive bound.
    const result = await verify(rawBody, `t=${t},v1=${hex}`, SECRET, {
      now: () => t + 300,
    });
    expect(result).toEqual({ ok: true });
  });

  it("tolerates whitespace between header parts (Stripe sends `t=…, v1=…`)", async () => {
    const rawBody = "whitespace_body";
    const t = 1_700_000_000;
    const hex = await signSampleHex(rawBody, t, SECRET);
    const result = await verify(rawBody, `t=${t}, v1=${hex}`, SECRET, {
      now: () => t,
    });
    expect(result).toEqual({ ok: true });
  });
});

describe("hmac.verify — invalid signature", () => {
  it("returns invalid_signature when the hex doesn't match", async () => {
    const rawBody = "real_body";
    const t = 1_700_000_000;
    // Use 64 chars of zeros — valid hex, but never matches a real HMAC.
    const fakeHex = "0".repeat(64);
    const result = await verify(rawBody, `t=${t},v1=${fakeHex}`, SECRET, {
      now: () => t,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("returns invalid_signature when the secret differs", async () => {
    const rawBody = "real_body";
    const t = 1_700_000_000;
    const hex = await signSampleHex(rawBody, t, SECRET);
    const result = await verify(
      rawBody,
      `t=${t},v1=${hex}`,
      "different_secret_that_was_not_used_to_sign_xxxxxxxxxxxxxxxxxxx",
      { now: () => t },
    );
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("returns invalid_signature when the body is tampered after signing", async () => {
    const original = "original_body";
    const tampered = "tampered_body";
    const t = 1_700_000_000;
    const hex = await signSampleHex(original, t, SECRET);
    const result = await verify(tampered, `t=${t},v1=${hex}`, SECRET, {
      now: () => t,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });
});

describe("hmac.verify — replay / clock skew", () => {
  it("returns signature_expired when timestamp is older than tolerance", async () => {
    const rawBody = "old_body";
    const t = 1_700_000_000;
    const hex = await signSampleHex(rawBody, t, SECRET);
    // now is 301 seconds after t — just outside the 300-second window.
    const result = await verify(rawBody, `t=${t},v1=${hex}`, SECRET, {
      now: () => t + 301,
    });
    expect(result).toEqual({ ok: false, reason: "signature_expired" });
  });

  it("returns signature_expired when timestamp is in the far future", async () => {
    const rawBody = "future_body";
    const t = 1_700_000_000 + 3_600; // 1h in the future relative to `now`
    const hex = await signSampleHex(rawBody, t, SECRET);
    const result = await verify(rawBody, `t=${t},v1=${hex}`, SECRET, {
      now: () => 1_700_000_000,
    });
    expect(result).toEqual({ ok: false, reason: "signature_expired" });
  });

  it("respects a custom tolerance window", async () => {
    const rawBody = "custom_tolerance_body";
    const t = 1_700_000_000;
    const hex = await signSampleHex(rawBody, t, SECRET);
    // Outside 10s tolerance — should expire.
    const result = await verify(rawBody, `t=${t},v1=${hex}`, SECRET, {
      now: () => t + 11,
      toleranceSec: 10,
    });
    expect(result).toEqual({ ok: false, reason: "signature_expired" });
  });
});

describe("hmac.verify — malformed header", () => {
  it("returns malformed_signature when header is empty", async () => {
    const result = await verify("body", "", SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("returns malformed_signature when `t=` is missing", async () => {
    const result = await verify("body", "v1=abc123", SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("returns malformed_signature when `v1=` is missing", async () => {
    const result = await verify("body", "t=1700000000", SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("returns malformed_signature when `t` is not a number", async () => {
    const result = await verify("body", "t=not_a_number,v1=abcdef", SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("returns malformed_signature when `v1` is not valid hex", async () => {
    const result = await verify("body", "t=1700000000,v1=zzz_not_hex", SECRET);
    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });

  it("returns malformed_signature when `v1` is odd-length hex", async () => {
    // Hex sig must be even length to decode to bytes. 63 chars = corrupt.
    const result = await verify(
      "body",
      `t=1700000000,v1=${"a".repeat(63)}`,
      SECRET,
    );
    expect(result).toEqual({ ok: false, reason: "malformed_signature" });
  });
});
