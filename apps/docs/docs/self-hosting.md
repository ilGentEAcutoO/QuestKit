---
sidebar_position: 4
title: Self-Hosting
description: Deploy your own QuestKit on your own Cloudflare account.
---

# Self-Hosting

QuestKit is 100% open source and runs on Cloudflare's free tier for low-volume usage. The full step-by-step guide — required CF account tier, resources to create, wrangler commands, secrets to set, estimated cost — lives in the repository:

**[docs/SELF_HOSTING.md on GitHub](https://github.com/ilGentEAcutoO/QuestKit/blob/main/docs/SELF_HOSTING.md)**

The guide is designed for a stranger to fork, run, and deploy in roughly 10 minutes.

## What you'll need

- A Cloudflare account (free tier works for everything except sustained heavy traffic).
- `wrangler` CLI v4+ — `pnpm install -g wrangler@4` or use the project-local copy from `pnpm install`.
- Node 20.x (see `.nvmrc`).
- A custom domain on Cloudflare DNS (optional — `.workers.dev` subdomains work as a fallback).

## Resources QuestKit provisions

| Resource type            | Quantity | CF binding name(s)                                       |
| ------------------------ | -------- | -------------------------------------------------------- |
| Worker                   | 6        | (api, webhook-relay, webhook-consumer, demo, docs, play) |
| D1 database              | 1        | `DB`                                                     |
| KV namespace             | 1        | `CACHE`                                                  |
| R2 bucket                | 1        | `ASSETS_R2`                                              |
| Queue (main)             | 1        | `WEBHOOK_QUEUE`                                          |
| Queue (DLQ)              | 1        | _auto-created_                                           |
| Durable Object class     | 2        | `RATE_LIMITER`, `SSE_HUB`                                |
| Analytics Engine dataset | 1        | `EVENTS_AE`                                              |
| Workers AI binding       | 1        | `AI`                                                     |

## Secrets

Three secrets, set via `wrangler secret put`:

- `JWT_SECRET` — ≥ 32 bytes. Generate via `openssl rand -base64 48`.
- `WEBHOOK_HMAC_SECRET` — ≥ 32 bytes. Same recipe.
- `APP_SECRET` — the secret your backend uses to mint JWTs via `POST /v1/auth/token`.

The full guide on GitHub walks through each `wrangler` command in order, with copy-pasteable snippets and verification steps.

## Cost estimate

For a demo workload (low traffic, < 1k events/day): **$0/month** on the Cloudflare free tier. The free quotas cover everything QuestKit needs — Workers requests, D1 reads/writes, KV ops, Queue messages, Workers AI inferences.
