# `@questkit/worker-api`

Cloudflare Worker: REST API, SSE fanout, Durable Objects, Workers AI personalisation.
Backs `api.questkit.jairukchan.com`.

## Local dev

```bash
pnpm install                              # from repo root
pnpm --filter @questkit/worker-api cf-typegen  # generate worker-configuration.d.ts
cp .dev.vars.example .dev.vars            # then fill secrets
pnpm --filter @questkit/worker-api dev    # serves http://127.0.0.1:8787
curl http://127.0.0.1:8787/v1/health
```

See the repo root [`docs/SELF_HOSTING.md`](../../docs/SELF_HOSTING.md) (added in TASK-031) for the full
Cloudflare resource provisioning checklist (D1, KV, R2, Queues, secrets).
