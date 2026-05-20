# Self-Hosting QuestKit

QuestKit is built entirely on Cloudflare's developer platform — no Vercel, no
Supabase, no third-party runtime. That means you can fork the repo, run one
interactive script, and have your own copy running on your own Cloudflare
account in about 10 minutes.

This guide is the end-to-end walkthrough. For the per-resource recipe
(individual `wrangler` commands you can run manually), see
[`CLOUDFLARE_SETUP.md`](./CLOUDFLARE_SETUP.md).

## 1. Goal

Deploy a fully-functioning QuestKit instance on your own Cloudflare account.
After 10 minutes you should have:

- The `api` Worker live at either a custom domain or a `*.workers.dev` URL,
  responding `200` on `/v1/health`.
- Five sibling Workers (demo, docs, playground, webhook-relay,
  webhook-consumer) deployable from the same monorepo with one
  `pnpm deploy` per Worker.
- A D1 database seeded with six demo missions and two campaigns.
- A KV namespace, an R2 bucket, two queues, two Durable Object classes, an
  Analytics Engine dataset, and a Workers AI binding — all named and wired
  to their respective bindings.

The "10 minutes" assumes the prerequisites below are already installed and
you don't pause to read every prompt. The longest individual wait is the
custom-domain TLS provisioning (~150 seconds); everything else takes
seconds.

## 2. What you'll need

| Tool      | Version  | Why                                                       |
| --------- | -------- | --------------------------------------------------------- |
| Node.js   | 20+      | Workers runtime + tooling                                 |
| pnpm      | 10.27    | Monorepo package manager (pinned in root `package.json`)  |
| Wrangler  | 4.90+    | Cloudflare CLI — ships as a workspace dev-dep             |
| Git       | any      | Fork + clone the repo                                     |
| `gh`      | optional | The GitHub CLI shortens the fork step but isn't required  |
| `openssl` | any      | Generates the three secrets — preinstalled on macOS/Linux |
| `bash`    | any      | The setup script. Git Bash on Windows works fine          |
| `curl`    | any      | Verifies the health-check at the end                      |

Also: **a Cloudflare account** (free tier sufficient) and a one-time
`wrangler login`. Optionally a domain on the same Cloudflare account if you
want custom subdomains.

## 3. Quick-start

```bash
gh repo fork ilGentEAcutoO/QuestKit --clone
cd QuestKit
pnpm install

# One-time login if you haven't done it before:
pnpm wrangler login

# Walks through the entire CLOUDFLARE_SETUP.md interactively:
./scripts/setup.sh

# Deploy the api Worker (others can be deployed one at a time):
pnpm --filter @questkit/worker-api deploy
```

That's the whole flow. Read on if you want to know what each step does or
hit a snag.

## 4. What `setup.sh` does

`scripts/setup.sh` is a plain bash script — no fancy TUI, no Node dependencies.
It asks three questions:

1. **Account ID?** — your Cloudflare account ID (`pnpm wrangler whoami`
   prints it).
2. **Custom domain?** — leave blank to use `*.workers.dev` URLs; provide
   a domain on your Cloudflare account to wire `api.<your-domain>` etc.
3. **Generate secrets now?** — `Y` runs three `openssl rand -base64 48`
   commands and pipes the output straight into `wrangler secret put` so the
   cleartext never lands on disk.

Then it runs the same `wrangler` commands you'd run from
[`CLOUDFLARE_SETUP.md`](./CLOUDFLARE_SETUP.md):

- `wrangler whoami` to verify auth
- `wrangler d1 create questkit-d1-main`
- `wrangler kv namespace create questkit-kv-cache`
- `wrangler r2 bucket create questkit-r2-assets`
- `wrangler queues create questkit-queue-webhooks`
- `wrangler queues create questkit-queue-webhooks-dlq`
- Captures every UUID from the command output and writes them into a fresh
  `workers/api/wrangler.dev.jsonc` (the file is gitignored — your IDs never
  enter git history).
- If you answered "yes" to secrets: `openssl rand -base64 48 | wrangler
secret put NAME --name questkit-worker-X` for each.

The script refuses to overwrite an existing `workers/api/wrangler.dev.jsonc`
without an explicit `Y` confirmation — if you've already partly run setup,
your real UUIDs are safe.

When it finishes, the script prints a summary:

```text
Your QuestKit deploy is set up. Next:

  pnpm --filter @questkit/worker-api db:migrate:remote
  pnpm --filter @questkit/worker-api deploy
  curl https://<your-url>/v1/health
```

If `setup.sh` errors out mid-flight, every command it runs is idempotent
— rerunning will skip already-created resources and recover gracefully.

## 5. Cost estimate

QuestKit is designed to live within Cloudflare's free tier for hobby use.

| Volume                               | Monthly cost | Notes                                                                                                          |
| ------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------- |
| ≤ 10 K events/day, ≤ 100 K reads/day | **$0**       | Everything except queues fits the free tier; queues require Workers Paid ($5/mo) but you can skip that pair    |
| 100 K events/day                     | **~$5**      | Workers Paid plan ($5) covers queues, Durable Objects' SQLite storage, and unmetered Workers AI fast neurons   |
| 1 M events/day                       | **~$25**     | Add ~$20 for queue messages above the Paid-plan included quota                                                 |
| 10 M events/day                      | **~$200**    | At this scale you'd want to revisit AE retention and R2 egress; the architecture supports it without a rewrite |

Workers AI's `@cf/meta/llama-3.1-8b-instruct-fast` is currently in the
Workers Paid plan's included "fast" neurons quota — no per-request charge
under typical recommendation volumes. The api Worker also caches every AI
response in KV for one hour, which keeps neuron usage low even under
bursty traffic.

## 6. Custom domain (optional)

If you own a domain on the same Cloudflare account, every Worker can serve
from a custom subdomain. Edit each Worker's `wrangler.jsonc` (or a sibling
`wrangler.dev.jsonc` for the api Worker) and add a `routes` block:

```jsonc
"routes": [{ "pattern": "api.yourdomain.com", "custom_domain": true }]
```

Then deploy that Worker. Cloudflare provisions the TLS cert in roughly 150
seconds. Suggested mapping:

| Worker                          | Default subdomain             |
| ------------------------------- | ----------------------------- |
| `questkit-worker-demo`          | apex or `demo.yourdomain.com` |
| `questkit-worker-api`           | `api.yourdomain.com`          |
| `questkit-worker-docs`          | `docs.yourdomain.com`         |
| `questkit-worker-play`          | `play.yourdomain.com`         |
| `questkit-worker-webhook-relay` | `webhook.yourdomain.com`      |

If you don't own a domain, the free `*.workers.dev` URLs work just as well
for testing — they're printed at the end of each `wrangler deploy`. You can
add custom domains later without redeploying the underlying Worker.

## 7. Troubleshooting

### `wrangler: not authenticated`

You skipped or expired the one-time login. Run:

```bash
pnpm wrangler login
pnpm wrangler whoami
```

### `D1 binding "DB" not found`

You haven't applied your real D1 UUID to `workers/api/wrangler.dev.jsonc`.
Check step 6 of [`CLOUDFLARE_SETUP.md`](./CLOUDFLARE_SETUP.md#6-wire-up-the-local-wranglerdevjsonc),
or rerun `./scripts/setup.sh` and confirm the file got written. The committed
`workers/api/wrangler.jsonc` deliberately keeps `database_id` as
`"<set-per-env>"` so the public repo never ships a real UUID.

### `Queue consumer can't bind to producer "questkit-queue-webhooks"`

Both the relay and the consumer reference `questkit-queue-webhooks`, but the
queue has to exist _and_ the api Worker has to be deployed first because the
consumer also binds to `questkit-worker-api` as a Service binding. Deploy
order:

```bash
pnpm wrangler queues create questkit-queue-webhooks
pnpm wrangler queues create questkit-queue-webhooks-dlq
pnpm --filter @questkit/worker-api deploy
pnpm --filter @questkit/worker-webhook-relay deploy
pnpm --filter @questkit/worker-webhook-consumer deploy
```

### `CI fails with "QUESTKIT_APP_SECRET" missing`

The Newman API contract job in `.github/workflows/ci.yml` reads
`QUESTKIT_APP_SECRET` from GitHub Actions secrets. Register it under your
fork at:

```text
Settings → Secrets and variables → Actions → New repository secret
```

The value should match the `APP_SECRET` you set on
`questkit-worker-api`. Without it, every push fails the contract job; the
Lint/Typecheck/Test job is unaffected.

### `wrangler.dev.jsonc not found`

Either you ran `pnpm --filter @questkit/worker-api deploy` without first
running `./scripts/setup.sh`, or the script never wrote the file. The api
Worker's deploy script uses the dev-jsonc directly because the committed
`wrangler.jsonc` is intentionally placeholder-only. Rerun the setup script;
it'll detect missing UUIDs and recreate the file.

### Workers AI errors locally

Workers AI has no local emulator — the binding is always remote, even in
`wrangler dev`. Local AI calls work only if you've logged in (`pnpm wrangler
login`). In CI without a Cloudflare API token, AI-touching tests are
skipped on purpose — see
[ADR-006](./decisions/006-test-boundaries-pool-workers-vs-service-stubs.md)
for why we test the AI service layer with stubs instead.

### TLS pending for ~150 seconds after custom-domain wire-up

This is normal. Cloudflare provisions a fresh ACME cert when a Worker first
binds to a custom subdomain. The deploy succeeds immediately but the URL
serves a 525 or hangs until the cert lands. Wait ~150 seconds and retry.

### "Workers Paid plan required" when deploying the consumer

Queues need Workers Paid for the consumer to actually drain messages. You
can deploy `--dry-run` on the free tier to confirm the config is valid, but
production deploys of the consumer Worker require upgrading at
<https://dash.cloudflare.com/?to=/:account/workers/plans>.

## 8. GitHub Actions CI/CD deploy

Once your fork is set up (you've run `setup.sh` once, the live URL responds
on `/v1/health`, and `pnpm test` is green), you can wire automatic deploys
on every push to `main` via `.github/workflows/deploy.yml`. The workflow is
already committed; you only need to add the GitHub secrets it reads.

### 8.1 Trigger model

`deploy.yml` triggers on `workflow_run` after the `CI` workflow (lint /
typecheck / test / sonar / newman) succeeds on `main`. That guarantees no
deploy ever ships a broken commit. A `workflow_dispatch` trigger is also
wired so a maintainer can re-deploy from the GitHub UI without pushing a
new commit (useful after rotating a secret).

The workflow does, in order:

1. Checkout the exact commit CI ran against.
2. `pnpm install --frozen-lockfile`, regenerate worker types, build
   `apps/demo`, `apps/docs`, `apps/playground`.
3. `wrangler d1 migrations apply questkit-d1-main --remote --env production`.
4. Deploy all six workers in dependency order: api → consumer → relay →
   demo → docs → playground.
5. `curl /v1/health` on the api worker and `curl /` on the demo apex; both
   must return 200 within three 10s-spaced retries.

Concurrency is fenced to `deploy-production` so two deploys can never race
each other into Cloudflare's worker-upload API (it 409s on concurrent
deploys of the same worker name).

### 8.2 Required GitHub Actions secrets

Register these under `Settings → Secrets and variables → Actions → New
repository secret`:

| Secret name            | What it is                                                                                                      | How to generate                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token used by `wrangler deploy` and `d1 migrations apply`.                                       | <https://dash.cloudflare.com/profile/api-tokens> — see scopes below. |
| `JWT_SECRET`           | HS256 signing key for `/v1/auth/token`. Must match what's on the api worker.                                    | `openssl rand -base64 48`                                            |
| `APP_SECRET`           | Shared secret between demo's `/api/token` proxy and api's `/v1/auth/token`. Same value on both workers.         | `openssl rand -base64 48`                                            |
| `WEBHOOK_HMAC_SECRET`  | HMAC-SHA256 key for inbound webhook signature verification. Same value on relay and api.                        | `openssl rand -base64 48`                                            |
| `QUESTKIT_APP_SECRET`  | Same value as `APP_SECRET`. Used by the existing Newman contract job in `ci.yml` (kept for historical reasons). | Same as `APP_SECRET` — paste twice.                                  |
| `SONAR_TOKEN`          | SonarCloud token. Used by the SonarCloud scan job in `ci.yml`.                                                  | <https://sonarcloud.io/account/security>                             |

> `CLOUDFLARE_ACCOUNT_ID` is **NOT** a secret. It's hard-coded into
> `deploy.yml` as `env.CLOUDFLARE_ACCOUNT_ID` and is the same account ID
> printed in every `wrangler deploy` log. Forkers must edit this value in
> `deploy.yml` to their own account ID before the workflow will deploy
> against their tenant.

### 8.3 Cloudflare API token scopes

The `CLOUDFLARE_API_TOKEN` needs only:

- **Account → Workers Scripts → Edit** — upload + publish all six workers.
- **Account → D1 → Edit** — run `wrangler d1 migrations apply`.
- **Account → Account Settings → Read** — required by `wrangler deploy`
  for account validation.
- **Zone → Workers Routes → Edit** (on the zone owning your custom
  domains) — needed for `routes` + `custom_domain` blocks. Skip if you
  deploy to `*.workers.dev` only.

Do **NOT** grant `Account → Account Settings → Edit` or any zone-level
write scopes beyond `Workers Routes`. The token never needs to mutate
account-level config.

### 8.4 What gets committed vs. what stays a secret

| Where                                            | What lives there                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workers/api/wrangler.jsonc` `env.production`    | Real D1 + KV UUIDs, R2 bucket name, route pattern. UUIDs are not secrets.                                                                                        |
| `workers/api/wrangler.dev.jsonc` (gitignored)    | Personal Cloudflare resources for local dev. Created by `./scripts/setup.sh`.                                                                                    |
| Cloudflare secrets store (`wrangler secret put`) | `JWT_SECRET`, `APP_SECRET`, `WEBHOOK_HMAC_SECRET` on every worker that needs them.                                                                               |
| GitHub Actions secrets                           | Same three secrets, plus `CLOUDFLARE_API_TOKEN`. The workflow uses `cloudflare/wrangler-action`'s `secrets:` input to push them into the worker on every deploy. |

This split keeps three properties true at once:

- A clean checkout can `wrangler deploy --env production` if you set the
  three GitHub secrets (zero ID injection required).
- A clean checkout reveals the production UUIDs publicly, which is fine —
  they're already visible in every CI log and dashboard URL.
- The actual signing keys (the three secrets) never enter source control
  or CI logs.

### 8.5 Verifying a deploy

After `deploy.yml` finishes, the workflow log ends with:

```text
[api /v1/health] OK (200) on attempt 1
[demo apex] OK (200) on attempt 1
```

If either check fails three times in a row, the deploy step exits non-zero
and you'll see a red X on the commit. Common causes:

- A secret is missing or stale. Check `wrangler secret list --name
questkit-worker-api`.
- D1 migrations failed mid-way. Check the migrations apply log for the
  exact error; re-running the workflow is safe because migrations are
  idempotent.
- A binding ID in `env.production` no longer exists in the Cloudflare
  account (e.g. somebody deleted the KV namespace). Recreate via
  `./scripts/setup.sh` and update `wrangler.jsonc` accordingly.

## 9. Next steps

- Read the [README](../README.md) for the elevator pitch and embedded demo
  links.
- Browse [`docs/decisions/`](./decisions/) for the architecture rationale —
  why Cloudflare-only, why SSE over WebSockets, why Workers AI for
  personalization, and so on.
- Visit the live docs site at <https://docs.questkit.jairukchan.com> (or
  point at your own once `questkit-worker-docs` is deployed).
- Embed the IIFE bundle in any HTML page and sanity-check the integration
  with `apps/playground` — three test pages (plain HTML, WordPress mock,
  iframe context) ship as part of `questkit-worker-play`.
- File an issue at <https://github.com/ilGentEAcutoO/QuestKit/issues> if
  anything in this guide didn't work — the 10-minute promise is verified
  against this doc, so a stuck step is a documentation bug we want to fix.
