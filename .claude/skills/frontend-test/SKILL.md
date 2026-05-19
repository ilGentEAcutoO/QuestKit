---
name: frontend-test
description: Comprehensive cross-functional frontend testing via MCP Playwright — always opens a real browser, clicks, and interacts. Use when user says "test frontend", "ทดสอบหน้าเว็บ", "เทส UI", "check the page", "เช็ค console", or after making frontend changes. This skill has TWO phases. Phase 1 (plan): generates test scenarios and ADDS them as tasks to the existing plan.md and todos.md via workflow-plan — then waits for user approval. Phase 2 (execute): after approval, runs all test tasks via MCP Playwright with PDCA cycle until zero errors and zero warnings. Phase 2 can be triggered by calling /frontend-test again or /workflow-work. All temp files go in ./agent-temp/.
---

# Frontend Test

Comprehensive frontend testing via **MCP Playwright** — always real browser interaction.

This skill operates in **two phases**, following the same plan → approve → work cycle as the rest of the workflow system.

## Phase 1: Plan Test Scenarios

**This phase uses workflow-plan** — it ADDS test scenarios as tasks to the existing plan and todos.

### 1. Ask test environment (if unknown)

> ทดสอบที่ไหนครับ? (local / staging / production)

- **local** → `http://localhost:3000`
- **staging** → staging URL (commit + push + wait for deploy before testing)
- **production** → production URL (commit + push + wait for GitHub Actions)

### 2. Read context

```bash
cat ./instruction/work/plan.md 2>/dev/null
cat ./instruction/work/todos.md 2>/dev/null
ls .claude/skills/
```

### 3. Generate test scenarios (use Agent Team)

Spawn an agent team to analyze the application and generate comprehensive test scenarios:

```
Team: test-scenario-planning
Lead (Opus 4.6) — synthesize into test plan section + tasks
├── Teammate A: Analyze plan/tasks → list all changed/added features
├── Teammate B: Analyze codebase → identify related systems and cross-functional impacts
├── Teammate C: Check .claude/skills/ → note relevant skills for potential fixes
└── Lead: Merge findings into detailed test scenario list
```

Generate scenarios covering **every case at every level**:

| Scenario Type         | What to Test                                   | Example                                     |
| --------------------- | ---------------------------------------------- | ------------------------------------------- |
| **Happy path**        | Feature works as requirement states            | Login with valid credentials → dashboard    |
| **Edge cases**        | Boundary conditions, empty states, long inputs | Empty form, 1000-char input, special chars  |
| **Error handling**    | Invalid inputs, permissions, failures          | Wrong password → error message              |
| **Cross-function**    | Feature A's changes don't break Feature B      | Auth changes → profile, settings still work |
| **Regression**        | Unchanged systems still function               | Navigation, search, existing CRUD           |
| **State transitions** | Multi-step flows complete correctly            | Create → Edit → Delete cycle                |

Prioritize:

1. Critical paths (login, main business flows, payments)
2. Changed code paths (directly related to current tasks)
3. Adjacent features (sharing components/APIs with changed code)
4. Peripheral features (unrelated but important — spot-check)

### 4. Add to plan and todos (via workflow-plan pattern)

**Append** a test plan section to `./instruction/work/plan.md`:

```markdown
> Added: YYYY-MM-DD HH:mm — Frontend Test Scenarios

## Frontend Test Plan

- Environment: local | staging | production
- Base URL: http://localhost:3000

### Scenarios

1. [Happy Path] Login flow — valid credentials → dashboard redirect
2. [Edge Case] Login — empty email, empty password, SQL injection attempt
3. [Cross-Function] After auth changes — profile page loads, settings save works
4. [Regression] Navigation menu — all links functional
   ...
```

**Append** test tasks to `./instruction/work/todos.md`:

```markdown
### Task: [TASK-0XX] Frontend Test — Login Happy Path

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Skills:** frontend-test
- **Subtasks:**
  - [ ] test: navigate to /login, fill credentials, verify redirect
  - [ ] test: check console for errors/warnings
  - [ ] fix: resolve any issues found (use relevant skills)
  - [ ] retest: verify fix, console clean

### Task: [TASK-0XX] Frontend Test — Cross-Function Auth Impact

- **Status:** ⚪ pending
- **Priority:** high
- **Parallel:** yes
- **Skills:** frontend-test
- **Subtasks:**
  - [ ] test: profile page loads after auth changes
  - [ ] test: settings page saves correctly
  - [ ] test: API calls authenticated properly
  - [ ] fix: resolve any issues found
  - [ ] retest: verify all clean
```

### 5. STOP — Wait for approval

Present the test plan to user. User may:

- **Approve** → proceed to Phase 2 (or user can trigger later via `/frontend-test` or `/workflow-work`)
- **Request changes** → add/remove/modify scenarios, adjust priorities, then re-present
- **Close session** → plan is saved, can resume anytime

## Phase 2: Execute Tests

Triggered when:

- User approves and says "ลุย", "เทสเลย", "go"
- User calls `/frontend-test` again (detects pending test tasks in todos.md)
- User calls `/workflow-work` (picks up test tasks along with other tasks)

### 1. Setup

```bash
mkdir -p ./agent-temp
```

All screenshots, logs, temp files → `./agent-temp/`. Never leave at project root.

### 2. Ensure environment ready

```bash
# Local
lsof -i :3000 || npm run dev &
sleep 3

# Staging/Production
# If code changes need deploying: use git-commit → git-push skills, wait for deploy
```

### 3. Execute test tasks (PDCA Cycle)

For each test task in todos.md:

```
PLAN: Read test scenario from task
  ↓
DO: Execute via MCP Playwright
  - playwright_navigate → target page
  - playwright_screenshot → save to ./agent-temp/
  - playwright_click, playwright_fill → interact
  - playwright_screenshot → verify result
  - playwright_console → check errors/warnings
  ↓
CHECK: Result correct? Console clean?
  ↓ No
ACT: Fix the issue
  1. Identify source file
  2. Read relevant .claude/skills/ before fixing
  3. Apply fix
  4. If staging/prod: commit → push → wait for deploy (use skills)
  5. Re-test (back to DO)
  ↓
CHECK: Clean now?
  ↓ Yes
Mark task ✅ → Next task
```

**Zero tolerance:** 0 errors AND 0 warnings in browser console after all tests complete.

**No artificial retry limit** — keep fixing until truly resolved. If fundamentally stuck, report to user with detailed findings.

### 4. Console severity

| Level     | Action                             |
| --------- | ---------------------------------- |
| `error`   | **MUST FIX** — do not proceed      |
| `warning` | **MUST FIX** — no warnings allowed |
| `log`     | Review if relevant                 |

### 5. Pre-fix: Check skills

```bash
ls .claude/skills/
```

**Always read the relevant SKILL.md before making any fix:**

| Skill       | Use For                          |
| ----------- | -------------------------------- |
| `nuxt/`     | Nuxt 3 conventions, auto-imports |
| `nuxt-ui/`  | Nuxt UI components, UIcon, props |
| `vue/`      | Vue 3 patterns, reactivity       |
| `tailwind/` | Utility classes                  |

### 6. Common fixes

| Console Message          | Likely Fix                        |
| ------------------------ | --------------------------------- |
| `[Vue warn]: ...`        | Check props, refs, lifecycle      |
| `hydration mismatch`     | `<ClientOnly>`, check `onMounted` |
| `404 (Not Found)`        | Check paths, routes               |
| `TypeError: Cannot read` | Null checks, optional chaining    |

## Test Report

After all test tasks complete, save to `./instruction/work/test-report.md`:

```markdown
# FRONTEND TEST REPORT

Tested: YYYY-MM-DD HH:mm
Environment: local | staging | production

## Scenarios Executed

Total: [N] scenarios across [M] pages

## Results by Category

### Happy Path: ✅ 5/5

### Edge Cases: ✅ 3/3

### Cross-Function: 🔧 4/5 (1 fixed)

### Regression: ✅ 8/8

## Issues Found & Fixed (PDCA Log)

1. `components/X.vue` — null check added
   - Found: cross-function — profile broke after auth change
   - Fix: optional chaining on user object
   - Re-test: ✅
   - Commit: [hash] (if staging/prod)

## Console Status

| Before        | After         |
| ------------- | ------------- |
| ❌ 2 errors   | ✅ 0 errors   |
| ⚠️ 3 warnings | ✅ 0 warnings |

## Impact Assessment

- Changed features: working as specified
- Related systems: no regressions
- Peripheral features: spot-checked OK
```
