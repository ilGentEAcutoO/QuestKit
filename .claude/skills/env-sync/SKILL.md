---
name: env-sync
description: Keep .env.example and .dev.vars.example in sync with actual env files. Use whenever creating, adding, removing, or renaming environment variables in .env, .dev.vars, or any env file. Also trigger on "sync env", "อัปเดต example", "env ครบไหม", after adding new API keys or secrets, or when reviewing code that references process.env / import.meta.env / c.env. Ensures .example files always reflect the real env structure with safe placeholder values and generation commands.
---

# Env Sync

Keep `.example` files in perfect sync with actual env files.

The `.example` file is the **single source of truth** for onboarding — if a new dev clones the repo and copies `.env.example` to `.env`, they should know exactly what to fill in, how to generate secrets, and what format each value expects.

## Workflow

### 1. Detect env files in project

```bash
# Find all env files (real and example)
find . -maxdepth 2 -name ".env*" -o -name "dev.vars*" -o -name ".dev.vars*" | grep -v node_modules | sort
```

Common pairs:

| Real File    | Example File        |
| ------------ | ------------------- |
| `.env`       | `.env.example`      |
| `.env.local` | `.env.example`      |
| `dev.vars`   | `dev.vars.example`  |
| `.dev.vars`  | `.dev.vars.example` |

### 2. Scan codebase for env usage

```bash
# Find all referenced env vars
grep -rhoE "(process\.env|import\.meta\.env|c\.env|Env\.)\.([A-Z_][A-Z0-9_]*)" src/ server/ app/ --include="*.ts" --include="*.vue" --include="*.js" --include="*.tsx" | sort -u

# Check wrangler.toml for vars
grep -A1 "\[vars\]" wrangler.toml 2>/dev/null
```

### 3. Compare real env vs example

Read both files. Flag:

- **Missing in example** — key exists in real env but not in example → add it
- **Extra in example** — key in example but not used anywhere → confirm removal with user
- **Order mismatch** — example should mirror real env's grouping and order
- **Missing generation hints** — secrets without generation commands

### 4. Generate the example file

## Example File Format

```bash
# ──────────────────────────────────────────
# App
# ──────────────────────────────────────────
APP_NAME=my-app
APP_URL=http://localhost:3000
NODE_ENV=development

# ──────────────────────────────────────────
# Database
# ──────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/myapp

# ──────────────────────────────────────────
# Auth / Secrets
# generate: openssl rand -base64 32
# ──────────────────────────────────────────
JWT_SECRET=
SESSION_SECRET=
ENCRYPTION_KEY=

# ──────────────────────────────────────────
# Third-party APIs
# get from: https://dashboard.stripe.com/apikeys
# ──────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# ──────────────────────────────────────────
# Cloudflare
# get from: https://dash.cloudflare.com/profile/api-tokens
# ──────────────────────────────────────────
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
```

## Format Rules

1. **Group related keys** with section headers using `# ───` dividers
2. **Add `# generate:` comment** above keys that can be auto-generated
3. **Add `# get from:` comment** with URL for third-party API keys
4. **Safe placeholder values:**
   - Secrets → leave empty (e.g. `JWT_SECRET=`)
   - URLs → use localhost or example format (e.g. `DATABASE_URL=postgresql://user:password@localhost:5432/mydb`)
   - Test keys → use obvious test prefixes (e.g. `sk_test_...`)
   - Booleans → use sensible dev defaults (e.g. `DEBUG=true`)
   - Names/labels → use descriptive placeholder (e.g. `APP_NAME=my-app`)
5. **Never put real secrets** in the example file
6. **Preserve order** from the real env file — example mirrors it exactly
7. **Add brief inline comment** if the purpose isn't obvious from the key name

## Generation Commands Reference

| Use Case                  | Command                                                      |
| ------------------------- | ------------------------------------------------------------ |
| Generic secret (32 bytes) | `openssl rand -base64 32`                                    |
| Generic secret (hex)      | `openssl rand -hex 32`                                       |
| JWT secret                | `openssl rand -base64 64`                                    |
| Encryption key (256-bit)  | `openssl rand -base64 32`                                    |
| UUID                      | `uuidgen` or `python3 -c "import uuid; print(uuid.uuid4())"` |
| Password hash salt        | `openssl rand -base64 16`                                    |
| API key format            | `openssl rand -hex 20`                                       |
| Cookie secret             | `openssl rand -base64 32`                                    |

## Verify .gitignore

After syncing, always verify:

```bash
# Ensure real env files are gitignored
grep -q "^\.env$\|^\.env\.local$" .gitignore && echo "OK" || echo "MISSING: add .env to .gitignore!"
grep -q "^dev\.vars$\|^\.dev\.vars$" .gitignore && echo "OK" || echo "MISSING: add dev.vars to .gitignore!"

# Ensure example files are NOT gitignored
git check-ignore .env.example && echo "WARNING: .env.example is gitignored!" || echo "OK"
```

## Output

After syncing, report:

```
ENV SYNC REPORT
===============
File: .env.example

Added:    REDIS_URL, NEW_API_KEY
Removed:  OLD_DEPRECATED_VAR (confirmed)
Reordered: grouped auth keys together

Generation hints added:
  JWT_SECRET      → openssl rand -base64 64
  SESSION_SECRET  → openssl rand -base64 32

.gitignore: ✅ .env ignored, .env.example tracked
```
