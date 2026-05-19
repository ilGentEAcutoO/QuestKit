---
name: workflow-end
description: Complete session with security review and archiving. Use when user says "ตรวจสอบ", "จบงาน", "done", "เสร็จแล้ว", or when all tasks show tested status. Runs security checks, generates summary, and archives completed work.
---

# Workflow End

Complete work session with security review and archiving.

## Workflow

### 1. Verify all tasks complete

Check todos.md — all tasks must be ✅ tested. If incomplete → inform user, suggest workflow-work.

### 2. Final test suite (use agent team)

Spawn an agent team for parallel final checks:

- **Teammate A (Opus 4.6):** Run test suite (`npm run test`, `npm run lint`, `npx tsc --noEmit`)
- **Teammate B (Opus 4.6):** Security review (see below)
- **Teammate C (Opus 4.6):** Run **frontend-test** skill on changed pages (comprehensive cross-function scenarios)
- **Teammate D (Opus 4.6):** Run **env-sync** skill if env vars changed

### 3. Security review

```bash
npm audit
grep -rn "password\|secret\|api_key\|token" src/ --include="*.ts" --include="*.vue" --include="*.js"
cat .gitignore | grep -E "\.env"
```

If issues found → create fix tasks, return to workflow-work.

### 4. Generate summary → `./instruction/work/session-summary-YYYYMMDD.md`

Include: tasks completed, test results, security status, files changed, notes.

### 5. Archive

```bash
NEXT=$(ls ./instruction/archive/ 2>/dev/null | grep -oE "^[0-9]+" | sort -rn | head -1 || echo 0)
DIR=$(printf "%03d" $((NEXT + 1)))-[plan-name]

mkdir -p ./instruction/archive/$DIR
cp ./instruction/work/{requirements,plan,todos,session-summary-*}.md ./instruction/archive/$DIR/ 2>/dev/null
```

### 6. Reset active work

Clear todos.md to empty state, remove plan.md / requirements.md / session-summary from work/.

### 7. Report completion with archive location.
