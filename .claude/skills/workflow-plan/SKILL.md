---
name: workflow-plan
description: TDD-based planning with agent teams. Use when user says "วางแผน", "plan", "อยากทำ...", "เพิ่มฟีเจอร์", or on change request during workflow-work (amendment mode). Creates plan.md and populates todos.md with actionable tasks. If existing plan hasn't been archived yet, ADDS to the current plan and tasks — never overwrites. This skill ends at plan completion — it does NOT start implementation. Use workflow-work to execute.
---

# Workflow Plan

Create TDD-based development plans. **Additive by default.** Ends when plan is approved.

## Additive Plan Rule

If `./instruction/work/plan.md` already exists and has NOT been archived:

- **ADD** the new plan section to the existing plan — do NOT overwrite
- **ADD** new tasks to todos.md — existing tasks remain untouched regardless of status (done or not)
- Number new tasks sequentially after existing ones (e.g. existing TASK-001~003 → new starts at TASK-004)
- Note the addition in plan.md with timestamp: `> Added: YYYY-MM-DD HH:mm — [New Feature Name]`

Only `workflow-end` archives a plan. Until then, plans accumulate.

## Workflow

### 1. Research (use Agent Team)

Spawn an agent team for parallel research — teammates communicate directly with each other to share findings and challenge assumptions:

```
Team: research-team
├── Teammate A: Context7 for framework docs (resolve-library-id → get-library-docs)
├── Teammate B: Scan existing codebase for patterns, conventions, and related code
├── Teammate C: Check available MCP tools and .claude/skills/ for relevant skills
└── Lead (main agent): Synthesize findings from all teammates into coherent context
```

Teammates share discoveries with each other — e.g. Teammate B finds existing auth patterns → messages Teammate A to check if framework docs have updated guidance.

Fallback: web search, llms.txt, node_modules README.

Inform user if MCP tools (Storybook, Playwright) are missing but continue.

### 2. Discuss details (Q&A)

Clarify: exact behavior, edge cases, UI/UX, performance, security.

### 3. Create or append plan → `./instruction/work/plan.md`

```markdown
# Plan: [Feature Name]

> Created: YYYY-MM-DD HH:mm
> Status: draft | approved

## Requirements

## Architecture

## Security Considerations

## Test Specifications (TDD)

### Unit Tests

### UI Tests (Storybook)

### E2E Tests (Playwright)

## Tasks

### TASK-001: [Name]

- Priority: high/medium/low
- Parallel: yes/no
- Depends on: -
- Skills: env-sync, frontend-test (list relevant skills to use during work)
- Subtasks:
  - [ ] implement: ...
  - [ ] test: ...
```

**Every task must list relevant skills** under `Skills:` — so workflow-work knows which skills to invoke.

### 4. Save original requirements → `./instruction/work/requirements.md`

Preserve exact user wording — never paraphrase. Append if file exists.

### 5. Plan approval

- If user didn't request draft → plan is immediately finalized, populate todos.md
- If user requested draft (`ฉบับร่าง`) → wait for approval before populating todos.md

When finalized, populate `./instruction/work/todos.md` (append if existing):

```markdown
# Active Tasks

> Last updated: YYYY-MM-DD HH:mm

### Task: [TASK-001] Name

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Assigned:** unassigned
- **Depends on:** -
- **Skills:** env-sync, frontend-test
- **Files:** `path/to/file.ts`
- **Subtasks:**
  - [ ] implement: description
  - [ ] test: unit/e2e
- **Progress Notes:**
  - HH:mm - Task created

## File Lock Registry

| File | Locked by | Task | Since |
| ---- | --------- | ---- | ----- |
```

### 6. STOP HERE

**Plan skill ends at this point.** Do NOT start implementation. User must trigger `workflow-work` to begin execution.

## Amendment Mode

Triggered when change request detected during workflow-work:

1. Pause current work
2. Review change impact
3. Update plan & tests (TDD) — additive, append changes
4. Check consistency with existing work
5. Create/update tasks
6. Resume after approval

## Task Design Principles

- **Parallel-friendly** — design for concurrent execution by agent teams
- **Self-contained** — clear inputs/outputs per task
- **Two-level done** — implement + test = DONE
- **Security-first** — consider attack vectors early
- **Skill-aware** — every task lists which skills apply
