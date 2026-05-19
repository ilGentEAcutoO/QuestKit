/**
 * QuestKit SDK error type — every public-API failure path throws this.
 *
 * Carries a stable machine-readable `code` so consumers can switch on it
 * without parsing the human-readable message. `status` is the HTTP status
 * when the failure originated from a server response (undefined when the
 * failure is purely client-side, e.g. config errors).
 *
 * Codes (stable contract):
 *   - "unauthorized"        — 401 from the server (token expired / revoked)
 *   - "forbidden"           — 403 (user mismatch / wrong app)
 *   - "not_found"           — 404 (mission/campaign id unknown)
 *   - "validation_error"    — 400 (request shape rejected by server)
 *   - "rate_limited"        — 429 (rate-limit DO tripped)
 *   - "server_error"        — 5xx from the server
 *   - "network_error"       — fetch threw / aborted unexpectedly
 *   - "invalid_response"    — server returned a non-JSON / malformed body
 *   - "config_error"        — SDK misconfiguration (e.g. missing baseUrl)
 */
export class QuestKitError extends Error {
  public readonly code: string;
  public readonly status: number | undefined;

  constructor(message: string, code: string, status?: number) {
    super(message);
    this.name = "QuestKitError";
    this.code = code;
    this.status = status;
    // Maintain prototype chain across transpilation targets — without this,
    // `instanceof QuestKitError` returns false when the bundle is compiled
    // to ES5 (rare for our consumers, but defensive is cheap).
    Object.setPrototypeOf(this, QuestKitError.prototype);
  }
}
