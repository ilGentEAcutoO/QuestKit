---
name: git-push
description: Push to remote and monitor GitHub Actions. Use when user says "push", "merge", "merge to [branch]", "merge chain", "promote to [env]". Supports merge chains (dev→uat→main). Automatically monitors CI/CD, detects errors, and fixes until success.
---

# Git Push

Push changes and monitor GitHub Actions until success.

## Workflow

### 1. Push

```bash
git push origin <current-branch>
# If no upstream:
git push -u origin <current-branch>
```

### 2. Check for GitHub Actions

```bash
ls -la .github/workflows/ 2>/dev/null
```

No workflows → done. Workflows exist → monitor.

### 3. Monitor

```bash
gh run watch
# or: gh run list --limit 1 --json status,conclusion,name
```

### 4. Handle failures

```bash
gh run view <run-id> --log-failed
```

Then: read error → identify issue → fix → commit & push → monitor again → loop until success or need user input.

### 5. When to ask user

- Need secrets/env vars not available
- Error requires architectural decision
- Multiple failures (>3) on same issue
- Permission/access issues
- Merge conflicts need resolution

## Merge Chain Support

For multi-branch workflows (dev → uat → main):

```
User: "merge to dev then uat then main"

1. Merge → dev, push, monitor Actions ✅
2. Merge → uat, push, monitor Actions ✅
3. Merge → main, push, monitor Actions ✅
```

**Important:** After merge, monitor the TARGET branch Actions (not source).

```bash
gh run list --branch <target> --limit 1
gh run watch $(gh run list --branch <target> --limit 1 --json databaseId -q '.[0].databaseId')
```

## Commands Reference

```bash
gh run list --limit 5                    # Recent runs
gh run list --branch main --limit 5      # Branch-specific
gh run view <run-id>                     # View run
gh run view <run-id> --log-failed        # Failed logs
gh run rerun <run-id> --failed           # Re-run failed
gh run watch <run-id>                    # Watch live
```
