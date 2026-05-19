---
name: workflow-work
description: Implementation with agent teams and sub-agents. Use when user approves plan, says "ลุย", "ทำเลย", "โอเคกับแพลน", "เริ่มเลย", "approved", "go ahead". Always use agent teams or sub-agents — never work alone. Reads plan.md and todos.md then executes all tasks, invoking relevant skills as specified in each task.
---

# Workflow Work

Implement plan using **agent teams** or **sub-agents**. Never work alone.

## Choosing: Agent Team vs Sub-Agent

| Use            | When                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Agent Team** | Tasks span multiple concerns, teammates need to share findings, coordinate on shared files, or challenge each other's approaches |
| **Sub-Agent**  | Quick focused task that reports back — no inter-agent communication needed (e.g. lint check, simple lookup)                      |

Both can be used in the same workflow. Default to agent teams for main implementation.

## Agent Team Assembly

Main agent (Opus 4.6) acts as **team lead** — coordinates work, assigns tasks, synthesizes results.

Teammates work independently, each in its own context window, and communicate **directly with each other** (not just through the lead).

### Model Selection

Opus 4.6 เป็น default ทุก agent — ลดไป Sonnet 4.6 เฉพาะเมื่อมั่นใจว่างานง่ายจริงๆ

| Task Type                         | Model      | Reason                               |
| --------------------------------- | ---------- | ------------------------------------ |
| Implementation (code, components) | Opus 4.6   | Default — code quality matters       |
| Unit/E2E test writing             | Opus 4.6   | Default — test logic needs reasoning |
| Security review                   | Opus 4.6   | Deep reasoning required              |
| Architecture decisions            | Opus 4.6   | Complex tradeoffs                    |
| Complex debugging                 | Opus 4.6   | Root cause analysis                  |
| Cross-review                      | Opus 4.6   | Default — review needs judgment      |
| Simple formatting/linting         | Sonnet 4.6 | OK — mechanical task                 |
| Simple file lookup/copy           | Sonnet 4.6 | OK — no reasoning needed             |

### Example: Agent Team

```
Plan has 4 tasks: auth API, login form, tests, DB migration

Team: feature-impl
Lead (Opus 4.6) — coordinator, does NOT implement directly
├── Teammate A (Opus 4.6) — TASK-001: auth API + DB migration
├── Teammate B (Opus 4.6) — TASK-002: login form component
├── Teammate C (Opus 4.6) — TASK-003: write tests (after A & B signal done)
└── Teammate D (Opus 4.6) — cross-review: test A's API, test B's form

Communication:
  A finishes type definitions → messages B directly: "Auth types ready at src/types/auth.ts"
  B updates form to use A's types → messages C: "Login form done, ready for tests"
  C writes tests → messages D: "Tests written, ready for review"
```

## Workflow

### 1. Load plan and tasks

```bash
cat ./instruction/work/plan.md
cat ./instruction/work/todos.md
```

### 2. Check skills per task

Each task in todos.md lists `Skills:` — ensure teammates read those skill files before starting work.

### 3. Analyze parallelization

- Group independent tasks → spawn as teammates simultaneously
- Identify dependencies → teammates wait and message each other
- Plan cross-review assignments

### 4. Spawn agent team with clear task assignments

Each teammate receives:

- Assigned task(s) from todos.md
- Relevant files to work on
- **Skills to read first** (from task's `Skills:` field)
- File lock instructions
- Who to message when done

### 5. Team rules

- **Use skills** — check `.claude/skills/` and task's `Skills:` field before working
- Lock files in File Lock Registry before editing
- Teammates communicate directly for coordination
- Update progress in todos.md
- Cannot ask user directly → message team lead
- Run tests after implementation

### 6. Change detection

If user requests changes mid-work → team lead pauses teammates, saves progress, switches to workflow-plan amendment mode (additive), resumes after approval.

## Cross-Review Pattern

Teammates review each other's work directly:

```
Teammate A implements → Teammate B reviews + tests A's code (messages A with feedback)
Teammate B implements → Teammate A reviews + tests B's code (messages B with feedback)
```

If review finds issues → teammate fixes directly, no round-trip through lead.

## Task Status Flow

```
⚪ pending → 🔵 in-progress → 🟢 implemented → ✅ tested
                                                  ↑
                                          (both impl + review pass)
```

## Error Handling

- Test failures: max 3 retries → mark ❌ blocked, team lead decides
- Teammate crash: save partial progress, unlock files, spawn replacement
- Dependency conflict: team lead resolves

## Integration Phase (after all tasks)

Team lead coordinates final checks:

1. Full test suite
2. **frontend-test** skill on changed pages
3. **env-sync** skill if env vars changed
4. Cross-teammate consistency check
5. Security quick-check
6. All tasks → ✅ tested
