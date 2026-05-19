/**
 * jwt.ts unit tests — written FIRST per TDD discipline.
 *
 * Coverage targets (per plan §6.2 + TASK-007 brief): every public surface of
 * sign/verify exercised, including each JwtError code (`expired`,
 * `invalid_signature`, `malformed`). Aim > 80 % line coverage on jwt.ts.
 */
import { describe, expect, it } from "vitest";
import { type JwtPayload, sign, verify } from "../src/auth/jwt";

const SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function makePayload(overrides: Partial<JwtPayload> = {}): JwtPayload {
  const iat = nowSec();
  return {
    sub: "u_test_1",
    iat,
    exp: iat + 3600,
    jti: "0123456789abcdef0123456789abcdef",
    ...overrides,
  };
}

describe("jwt.sign", () => {
  it("produces a 3-part dot-joined token whose middle segment decodes to the payload", async () => {
    const payload = makePayload();
    const token = await sign(payload, SECRET);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    // Decode middle segment via base64url.
    const middle = parts[1]!;
    const b64 = middle.replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = JSON.parse(atob(padded));
    expect(decoded).toEqual(payload);
  });
});

describe("jwt.verify (happy path)", () => {
  it("round-trips the payload", async () => {
    const payload = makePayload();
    const token = await sign(payload, SECRET);
    const verified = await verify(token, SECRET);
    expect(verified).toEqual(payload);
  });
});

describe("jwt.verify (errors)", () => {
  it("rejects with JwtError(expired) when exp < now", async () => {
    const past = nowSec() - 3600;
    const payload = makePayload({ iat: past - 3600, exp: past });
    const token = await sign(payload, SECRET);
    await expect(verify(token, SECRET)).rejects.toMatchObject({
      name: "JwtError",
      code: "expired",
    });
  });

  it("rejects with JwtError(invalid_signature) when the signature is tampered", async () => {
    const token = await sign(makePayload(), SECRET);
    const [h, p] = token.split(".");
    // Flip the last char of the sig to force a mismatch.
    const sig = token.split(".")[2]!;
    const tamperedSig = sig.slice(0, -1) + (sig.slice(-1) === "A" ? "B" : "A");
    const tampered = `${h}.${p}.${tamperedSig}`;
    await expect(verify(tampered, SECRET)).rejects.toMatchObject({
      name: "JwtError",
      code: "invalid_signature",
    });
  });

  it("rejects with JwtError(invalid_signature) when signed with a different secret", async () => {
    const token = await sign(makePayload(), SECRET);
    const otherSecret =
      "different_secret_padded_to_be_long_enough_for_realism_xxxxxxxxxxx";
    await expect(verify(token, otherSecret)).rejects.toMatchObject({
      name: "JwtError",
      code: "invalid_signature",
    });
  });

  it("rejects with JwtError(malformed) when the token is not 3 parts", async () => {
    await expect(verify("a.b", SECRET)).rejects.toMatchObject({
      name: "JwtError",
      code: "malformed",
    });
    await expect(verify("a.b.c.d", SECRET)).rejects.toMatchObject({
      name: "JwtError",
      code: "malformed",
    });
    await expect(verify("", SECRET)).rejects.toMatchObject({
      name: "JwtError",
      code: "malformed",
    });
  });

  it("rejects with JwtError(malformed) when payload base64 is garbage", async () => {
    // Header valid; payload not valid base64url-of-JSON.
    const fakePayload = "%%%not-base64-at-all%%%";
    const token = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${fakePayload}.AAAAAA`;
    await expect(verify(token, SECRET)).rejects.toMatchObject({
      name: "JwtError",
      code: "malformed",
    });
  });
});
