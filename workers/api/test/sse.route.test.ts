/**
 * /v1/sse integration tests — TASK-011.
 *
 * Mounted route under test:  GET /v1/sse/updates
 * Auth:                       JWT Bearer (requireAuth)
 * Side effects:               opens an SSEHub DO subscription
 *
 * Test design notes:
 *
 *   - We hit `SELF.fetch` so the full middleware stack (Hono → /v1/sse →
 *     requireAuth → route handler → DO stub) is exercised end-to-end.
 *
 *   - To read the streamed body we use `reader.read()` on the response body
 *     and assert the first chunk contains the `: connected` sentinel that
 *     the DO emits on subscribe. We never wait for a broadcast in the
 *     integration test (that's covered by sse-hub.test.ts) - we just need
 *     to prove the upgrade succeeded.
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { type JwtPayload, sign } from "../src/auth/jwt";

const JWT_SECRET =
  "test_jwt_secret_do_not_use_in_prod_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

async function mintToken(userId: string): Promise<string> {
  const iat = nowSec();
  const exp = iat + 3600;
  const jti = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const payload: JwtPayload = { sub: userId, iat, exp, jti };
  return sign(payload, JWT_SECRET);
}

async function readOneChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = "";
  // Wait until we see the SSE double-newline (i.e. one full frame).
  while (!buf.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value !== undefined) buf += decoder.decode(value, { stream: true });
  }
  return buf;
}

describe("/v1/sse/updates — auth", () => {
  it("returns 401 without a JWT", async () => {
    const res = await SELF.fetch("https://api.test/v1/sse/updates");
    expect(res.status).toBe(401);
    // Cancel the body so the underlying stream is released.
    void res.body?.cancel();
  });

  it("returns 401 with an invalid JWT", async () => {
    const res = await SELF.fetch("https://api.test/v1/sse/updates", {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(res.status).toBe(401);
    void res.body?.cancel();
  });
});

describe("/v1/sse/updates — happy path", () => {
  it("opens a text/event-stream response and emits the connected sentinel", async () => {
    const userId = "u_sse_route_happy";
    const token = await mintToken(userId);
    const res = await SELF.fetch("https://api.test/v1/sse/updates", {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    // Cache-Control and X-Accel-Buffering ride along from the DO's
    // /subscribe handler. The route doesn't re-wrap them - this is the
    // documented "proxy verbatim" behaviour.
    expect(res.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(res.headers.get("x-accel-buffering")).toBe("no");

    const reader = res.body!.getReader();
    const frame = await readOneChunk(reader);
    expect(frame).toContain(": connected");
    void reader.cancel();
  });
});
