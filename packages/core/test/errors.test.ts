import { QuestKitError } from "../src/errors";

describe("questKitError", () => {
  it("carries the message, code, and status", () => {
    const e = new QuestKitError("nope", "unauthorized", 401);
    expect(e.message).toBe("nope");
    expect(e.code).toBe("unauthorized");
    expect(e.status).toBe(401);
    expect(e.name).toBe("QuestKitError");
  });

  it("omits status when not passed", () => {
    const e = new QuestKitError("nope", "config_error");
    expect(e.status).toBeUndefined();
  });

  it("retains instanceof identity across compilation targets", () => {
    const e = new QuestKitError("x", "y");
    expect(e instanceof QuestKitError).toBe(true);
    expect(e instanceof Error).toBe(true);
  });

  it("preserves a usable stack trace", () => {
    const e = new QuestKitError("with stack", "server_error", 500);
    expect(typeof e.stack).toBe("string");
    expect(e.stack ?? "").toContain("QuestKitError");
  });
});
