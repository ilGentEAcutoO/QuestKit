# Cloudflare Setup

This is the infrastructure recipe. It walks through every Cloudflare resource
that has to exist before any of QuestKit's six Workers can deploy. Every command
is copy-pasteable and every resource name follows the project convention
`questkit-[service]-[purpose]` so you can paste output directly into config
files without renaming. For end-to-end "fork and deploy" instructions —
including the optional `scripts/setup.sh` automation — see
[`SELF_HOSTING.md`](./SELF_HOSTING.md).

## 0. Prerequisites

You need three things:

1. **A Cloudflare account.** The free tier is enough for QuestKit's full
   feature set at low volume. Sign up at <https://dash.cloudflare.com/sign-up>
   if you don't already have one.
2. **Node.js 20+ and pnpm 10.27.** Wrangler ships as a workspace dev-dep so
   the local `pnpm wrangler` binary is the version we test against — you don't
   need a global Wrangler install.
3. **A one-time `wrangler login`.** From the repo root:

   ```bash
   pnpm wrangler login
   ```

   This opens a browser tab, hands you back an OAuth token, and stores it in
   `~/.wrangler/`. Every command below assumes you've done this once. Verify
   with `pnpm wrangler whoami` — you should see your account email and ID.

> Workers Paid is **not** required to follow this guide. Queues need the paid
> plan to deploy in production, but every other binding here works on the free
> tier. See [`SELF_HOSTING.md#cost-estimate`](./SELF_HOSTING.md#5-cost-estimate)
> for the breakdown.

## 1. Create the D1 database

D1 is QuestKit's source of truth — missions, progress, balances, events,
campaigns, and webhook log all live here. One database, eight tables, six
indexes.

```bash
pnpm wrangler d1 create questkit-d1-main --location apac
```

Pick the `--location` closest to your users (`apac`, `weur`, `eeur`, `wnam`,
`enam`, `oc`). Output looks like:

```text
✅ Successfully created DB 'questkit-d1-main' in region APAC

[[d1_databases]]
binding = "DB"
database_name = "questkit-d1-main"
database_id = "<your-d1-uuid>"
```

**Save the `database_id`** — you'll paste it into `workers/api/wrangler.dev.jsonc`
in step 7. The default `wrangler.jsonc` ships with the placeholder
`"<set-per-env>"` so the repo can stay public without leaking your UUID.

## 2. Create the KV namespace

KV stores three things: 24-hour idempotency keys for `/v1/events`, a JWT
denylist for revoked tokens, and 1-hour caches of AI recommendation responses.

```bash
pnpm wrangler kv namespace create questkit-kv-cache
```

Output:

```text
🌀 Creating namespace with title "questkit-kv-cache"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
[[kv_namespaces]]
binding = "CACHE"
id = "<your-kv-id>"
```

Save the `id` — it goes alongside the D1 UUID in step 7.

## 3. Create the R2 bucket

R2 holds badge icons, campaign banners, and export downloads. The binding name
is `ASSETS_R2` (not `ASSETS`) so it doesn't collide with the Workers Static
Assets binding name used by the demo, docs, and playground workers.

```bash
pnpm wrangler r2 bucket create questkit-r2-assets --location apac
```

R2 buckets don't have a per-resource UUID — they're addressed by name — so
there's nothing extra to capture here. The binding in
`workers/api/wrangler.jsonc` already references the bucket name directly.

## 4. Create both queues

Two queues: the main one and an explicit dead-letter queue (DLQ) that catches
messages that fail five retries.

```bash
pnpm wrangler queues create questkit-queue-webhooks
pnpm wrangler queues create questkit-queue-webhooks-dlq
```

Each command prints:

```text
✅ Created queue 'questkit-queue-webhooks'
```

Queues, like R2 buckets, are referenced by name (not UUID) in the wrangler
configs, so you don't need to copy anything from this output.

> Queues require **Workers Paid** to deploy in production (the consumer
> Worker won't bind to a queue on the free tier). Local dev and `wrangler
deploy --dry-run` work without it. If you only need the API + demo for an
> evaluation, you can skip step 4 and the consumer/relay workers — the rest
> of QuestKit functions without the webhook pipeline.

## 5. Set secrets per Worker

Secrets are per-Worker, never committed, and rotatable without redeploy.
Generate fresh values with `openssl rand -base64 48` and pipe them straight
into `wrangler secret put` so the cleartext never lands on disk or in your
shell history.

The `api` Worker needs three secrets:

```bash
openssl rand -base64 48 | pnpm wrangler secret put JWT_SECRET --name questkit-worker-api
openssl rand -base64 48 | pnpm wrangler secret put APP_SECRET --name questkit-worker-api
openssl rand -base64 48 | pnpm wrangler secret put WEBHOOK_HMAC_SECRET --name questkit-worker-api
```

The `webhook-relay` Worker needs the **same** `WEBHOOK_HMAC_SECRET` you set
above — the relay is the producer that signs incoming webhooks and the api
is the consumer that verifies them. Set it on the relay too:

```bash
# Use the same value as questkit-worker-api's WEBHOOK_HMAC_SECRET.
# Re-piping a fresh openssl call would generate a NEW value and break verification.
pnpm wrangler secret put WEBHOOK_HMAC_SECRET --name questkit-worker-webhook-relay
# (paste the same value you used above when prompted)
```

The `demo` Worker needs `APP_SECRET` to match the api Worker — they're peers
in the JWT mint flow: the demo's `/api/token` proxy hands `APP_SECRET` to the
api's `/v1/auth/token` endpoint.

```bash
# Same APP_SECRET value as questkit-worker-api.
pnpm wrangler secret put APP_SECRET --name questkit-worker-demo
# (paste the same value you used above when prompted)
```

That's it for secrets:

| Secret                | api | webhook-relay | demo | Purpose                                     |
| --------------------- | --- | ------------- | ---- | ------------------------------------------- |
| `JWT_SECRET`          | ✅  |               |      | HS256 signing key for short-lived JWTs      |
| `APP_SECRET`          | ✅  |               | ✅   | Shared secret for the `/v1/auth/token` call |
| `WEBHOOK_HMAC_SECRET` | ✅  | ✅            |      | HMAC verification for inbound webhooks      |

Confirm what's set on each Worker with `pnpm wrangler secret list --name <worker>`.

## 6. Wire up the local `wrangler.dev.jsonc`

The repo's committed `workers/api/wrangler.jsonc` keeps `database_id` and the
KV `id` as `"<set-per-env>"` placeholders. Real values live in
`workers/api/wrangler.dev.jsonc`, which is **gitignored** (see the project
`.gitignore`).

Create `workers/api/wrangler.dev.jsonc` with the same structure as the
committed file, swapping in the UUIDs you just captured:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "questkit-worker-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-19",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },

  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "questkit-d1-main",
      "database_id": "<your-d1-uuid>",
    },
  ],
  "kv_namespaces": [{ "binding": "CACHE", "id": "<your-kv-id>" }],
  "r2_buckets": [
    { "binding": "ASSETS_R2", "bucket_name": "questkit-r2-assets" },
  ],

  "queues": {
    "producers": [
      { "binding": "WEBHOOK_QUEUE", "queue": "questkit-queue-webhooks" },
    ],
  },

  "durable_objects": {
    "bindings": [
      { "name": "RATE_LIMITER", "class_name": "RateLimiter" },
      { "name": "SSE_HUB", "class_name": "SSEHub" },
    ],
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["RateLimiter", "SSEHub"] },
  ],

  "analytics_engine_datasets": [
    { "binding": "EVENTS_AE", "dataset": "questkit_events" },
  ],

  "ai": { "binding": "AI" },
}
```

This file is what `wrangler deploy --config workers/api/wrangler.dev.jsonc`
reads — your real UUIDs never enter git history.

If you'd rather have a script do all of this for you, run
`./scripts/setup.sh` from the repo root and skip ahead to step 8 — see
[`SELF_HOSTING.md#3-quick-start`](./SELF_HOSTING.md#3-quick-start).

## 7. Apply the D1 migrations

The api Worker's `package.json` ships a `db:migrate:remote` script that runs
both migrations against the live D1 instance:

```bash
pnpm --filter @questkit/worker-api db:migrate:remote
```

You should see two migrations applied:

```text
🌀 Mapping SQL input into an array of statements
🌀 Executing on remote database questkit-d1-main:
🚣 22 commands executed successfully.
🚣 9 commands executed successfully.
```

The first migration (`0001_init.sql`) creates 8 tables and 13 named indexes.
The second (`0002_seed_sample_data.sql`) inserts 6 seed missions across 2
campaigns so you can hit the demo flow immediately — every mission exercises
a different rule-engine input combination. If you'd rather start with a clean
database, edit `workers/api/package.json` and drop the seed call.

Verify the seed succeeded:

```bash
pnpm wrangler d1 execute questkit-d1-main \
  --remote \
  --config workers/api/wrangler.dev.jsonc \
  --command "SELECT COUNT(*) FROM missions;"
```

You should see `6` in the result.

## 8. (Optional) Custom-domain setup

If you own a domain on the same Cloudflare account, you can wire each Worker
to a subdomain in one config change — no DNS records, no `wrangler.toml`
hooks needed. Cloudflare auto-provisions the TLS certificate; it's typically
ready in about 150 seconds.

Edit `workers/api/wrangler.dev.jsonc` (the gitignored copy from step 6) and
add a `routes` block:

```jsonc
{
  // ...all the existing keys...
  "routes": [{ "pattern": "api.yourdomain.com", "custom_domain": true }],
}
```

Then deploy:

```bash
pnpm --filter @questkit/worker-api deploy:dry-run     # sanity-check the config
pnpm --filter @questkit/worker-api deploy             # ships and provisions TLS
```

Wait roughly 150 seconds for the certificate, then verify:

```bash
curl https://api.yourdomain.com/v1/health
# → {"ok":true,"version":"0.1.0","commit":"<sha>"}
```

If you don't own a domain (or the zone isn't on this Cloudflare account),
skip this step — every Worker also publishes to a free
`*.workers.dev` subdomain when you deploy.

Repeat the `routes` pattern in the other workers' `wrangler.jsonc` files if
you want full custom domains: `webhook.yourdomain.com` for the relay,
`docs.yourdomain.com` for docs, `play.yourdomain.com` for the playground,
and `yourdomain.com` (apex) for the demo.

## 9. Verify the deploy

The `/v1/health` endpoint is the canary. Once the api Worker is deployed
(either to your custom domain or the `*.workers.dev` URL it printed), curl it:

```bash
curl https://api.yourdomain.com/v1/health
# or whichever URL `wrangler deploy` printed:
# curl https://questkit-worker-api.<your-subdomain>.workers.dev/v1/health
```

A healthy response:

```json
{ "ok": true, "version": "0.1.0", "commit": "<sha or dev>" }
```

If `/v1/health` returns 200, every binding wired correctly — D1, KV, R2,
queues, Durable Objects, Analytics Engine, and Workers AI are all running.
Head back to [`SELF_HOSTING.md`](./SELF_HOSTING.md) for the rest of the
fork-to-deploy walkthrough, and consult its
[troubleshooting section](./SELF_HOSTING.md#7-troubleshooting) if anything
above didn't land cleanly.
