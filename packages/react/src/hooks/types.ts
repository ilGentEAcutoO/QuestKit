/**
 * Shared hook return shape.
 *
 * Design choices:
 *
 *   - `data` is `T | undefined` (not `T | null`). The fetch hasn't returned
 *     yet, so semantically the value is "absent" rather than "the server
 *     returned null". For balance, `null` is a meaningful server response
 *     (no row in that currency) — using `undefined` here lets the caller
 *     distinguish "loading" from "loaded, no data".
 *
 *   - `error` is `QuestKitError | null` (NOT undefined). Errors are nullable
 *     state — we want strict-equality checks (`if (error !== null)`) instead
 *     of the implicit-coercion footgun that `undefined` invites in JSX
 *     conditional rendering.
 *
 *   - `isLoading` / `isSuccess` / `isError` are derived flags but exposed
 *     directly so consumers don't have to rederive them on every render.
 *     They are mutually exclusive: at most one is `true` at a time. The
 *     initial render has `isLoading: true`; after that, success or error
 *     drives which other flag flips.
 *
 *   - `refetch` returns `Promise<void>`. It resolves once the fetch settles
 *     (success or failure). Callers that need to know success can read
 *     `isError` afterwards.
 */
import type { QuestKitError } from "@questkit/core";

export interface HookState<T> {
  data: T | undefined;
  error: QuestKitError | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  refetch: () => Promise<void>;
}
