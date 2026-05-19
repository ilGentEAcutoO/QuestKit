# Architecture Decision Records

These ADRs document the non-obvious technical choices behind QuestKit. Each
record states a decision, names the alternatives, and explains why one was
chosen. They're the short answer to "why X over Y" for a senior engineer
skimming the repo without reading every commit.

| ADR                                                           | Decision                                                                                                                     | One-line rationale                                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [001](./001-cloudflare-only-stack.md)                         | Every URL terminates at a Cloudflare Worker — no Vercel, no Pages                                                            | Portfolio piece for a Cloudflare-native role; uniform deploy flow and cost model beat a multi-provider patchwork        |
| [002](./002-react-instead-of-vue.md)                          | React with a `^18.3 \|\| ^19` peer-dep, not Vue                                                                              | The job description asked for React; a Vue developer shipping production-grade React demonstrates cross-framework reach |
| [003](./003-sse-over-websockets.md)                           | Live updates via SSE through a per-user `SSEHub` Durable Object                                                              | One-way fanout doesn't need WebSocket complexity; EventSource's built-in reconnect carries the resilience               |
| [004](./004-durable-objects-for-rate-limiting.md)             | Per-JWT sliding window in a SQLite-backed `RateLimiter` DO                                                                   | Single-writer DO + persistent SQL gives precision KV/D1/Redis can't match without breaking the Cloudflare-only rule     |
| [005](./005-workers-ai-for-personalization.md)                | Recommendations via `env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast')` with a 1 h KV cache                                  | No user-vector store, no off-platform inference, structured prompts only — and a hallucination filter for the model     |
| [006](./006-test-boundaries-pool-workers-vs-service-stubs.md) | Test pure logic at the service layer with hand-rolled env stubs; reserve `cloudflare:test` for paths that don't need mocking | `vi.mock` can't cross the workerd isolate boundary — Phase 3 lesson, now a permanent rule with sanctioned patterns      |

## Format

Each ADR follows the same template: **Context → Decision → Consequences
(Positive / Negative / Neutral) → Alternatives considered → References**.
ADRs are immutable once accepted — to revise a decision, add a new ADR that
supersedes the old one and update both `status` fields.

## When to write a new ADR

Add an ADR when a decision is:

- **Non-obvious** — the reasoning isn't visible from reading the code.
- **Cross-cutting** — affects multiple packages or workers.
- **Hard to reverse** — undoing it would require coordinated changes.
- **Defensible in an interview** — a reviewer will ask "why X over Y" and
  deserves a documented answer.

Routine implementation choices (which CSS variable name, which folder
layout) do not need ADRs. Tradeoffs do.
