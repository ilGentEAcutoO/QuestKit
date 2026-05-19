---
name: cloudflare-naming
description: Naming conventions for Cloudflare resources. Use when creating ANY Cloudflare resource (D1, KV, R2, Workers, Pages, Queues, Hyperdrive, Durable Objects). All resources MUST follow [projectname]-[service]-[purpose] pattern. Trigger even if user doesn't mention naming — enforce automatically.
---

# Cloudflare Naming Convention

All Cloudflare resources follow: `[projectname]-[service]-[purpose]`

## Examples

```
lottery-d1-main          # D1 main database
lottery-kv-cache         # KV cache storage
lottery-r2-uploads       # R2 user uploads
lottery-worker-api       # Worker API
lottery-pages-web        # Pages website
lottery-queue-emails     # Queue for emails
```

## Detect Project Name

```bash
# From wrangler.toml
grep -E "^name\s*=" wrangler.toml | head -1 | cut -d'"' -f2

# From package.json
jq -r '.name' package.json | sed 's/@.*\///'

# Ask user if unclear
```

## Wrangler Bindings (UPPER_SNAKE_CASE)

```toml
[[d1_databases]]
binding = "DB_MAIN"
database_name = "lottery-d1-main"

[[kv_namespaces]]
binding = "KV_CACHE"
id = "xxx"

[[r2_buckets]]
binding = "R2_UPLOADS"
bucket_name = "lottery-r2-uploads"
```

## Rules

- Lowercase only, hyphens as separators
- Always prefix with project name
- No spaces, underscores, or uppercase
- No generic names like `database-1` or `my-kv`
- Check existing resources before creating new
