---
name: deploy
description: Deploy application with CI/CD priority. Use when user says "deploy", "ship it", "ส่งขึ้น production", "ขึ้น staging". ALWAYS checks for GitHub Actions first — if CI/CD exists, uses commit+push instead of direct CLI tools.
---

# Deploy

Deploy with CI/CD priority.

## Critical: CI/CD First

**ALWAYS check for GitHub Actions before using direct CLI.**

```
Deploy request
    ↓
Check: .github/workflows/ exists?
    ↓
YES → git commit + push (CI/CD handles deploy)
NO  → direct CLI fallback
```

## Decision Tree

```
Has .github/workflows/*deploy* ?
├── YES → Commit & Push → Monitor GitHub Actions
│         (Use git-commit + git-push skills)
│
└── NO → Has wrangler.toml?
         ├── YES → npx wrangler deploy
         │
         └── NO → Has vercel.json?
                  ├── YES → npx vercel --prod
                  │
                  └── NO → Has deploy script?
                           ├── YES → npm run deploy
                           └── NO → Ask user
```

## Via CI/CD (Preferred)

```bash
git add -A
git commit -m "deploy: [description]"
git push origin <branch>
```

Then use **git-push** skill to monitor Actions.

## Via Direct CLI (Fallback)

Only if NO GitHub Actions exist:

```bash
# Cloudflare
npx wrangler deploy
npx wrangler pages deploy ./dist

# Vercel
vercel --prod

# Netlify
netlify deploy --prod
```

## Pre-deploy Checklist

```bash
npm run test
npm run build
npx tsc --noEmit
npm run lint
```

## Environment mapping

- `main`/`master` → Production
- `staging`/`develop` → Staging/Preview

## Post-deploy

```bash
curl -I https://your-app.com
```

Use **frontend-test** skill on production URL if applicable.

## Rollback

- Via CI/CD: `git revert HEAD && git push`
- Via Wrangler: `npx wrangler rollback`
