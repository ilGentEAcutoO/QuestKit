---
name: workflow-todo
description: Check and load pending tasks. Use this skill at session start, when user asks about task status, says "มีงานค้างไหม", "status", "ทำอะไรอยู่", "continue", or any indication they want to know what's pending. Also triggers when resuming interrupted work.
---

# Workflow Todo

Read `./instruction/work/todos.md` and present task status.

## Workflow

### 1. Read todos.md

```bash
cat ./instruction/work/todos.md
```

### 2. If tasks exist

Show status summary. Ask user:

- Continue pending tasks → workflow-work
- Start fresh (archive old) → workflow-plan
- View task details

### 3. If RESUME CONTEXT section exists

Previous session was interrupted (from workflow-exit). Show exit timestamp, per-task progress, and ask whether to resume.

### 4. If no tasks

Ready for new work → guide to workflow-plan.

## Status Icons

| Icon | Meaning                  |
| ---- | ------------------------ |
| ⚪   | pending                  |
| 🔵   | in-progress              |
| 🟢   | implemented (needs test) |
| ✅   | tested (done)            |
| ❌   | blocked                  |
