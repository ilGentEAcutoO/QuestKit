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

## 8. Next steps

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
