# `@questkit/playground`

`questkit-worker-play` — a static-asset Cloudflare Worker that proves the
[`@questkit/embed`](../../packages/embed) IIFE bundle mounts QuestKit widgets correctly
in real host-page contexts. Three host pages, one shared embed bundle, no server logic.

## What's here

| Page                                             | Purpose                                                                                                                                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`public/index.html`](public/index.html)         | Minimal plain HTML page demonstrating the canonical embed snippet — `<script src="/questkit.iife.js" data-questkit-...>` plus a couple of `<div data-questkit="...">` mount points.                          |
| [`public/wordpress.html`](public/wordpress.html) | A fake WordPress theme (serif font on body, brown `.wp-content *` overrides, dotted `<article>` borders, sidebar widgets) that mounts the same widgets. Proves Shadow DOM isolates against hostile host CSS. |
| [`public/iframe.html`](public/iframe.html)       | Outer page that loads `index.html` inside an `<iframe>`. Proves the embed works when the host page sandboxes us.                                                                                             |

## Run locally

```bash
pnpm install                                      # from repo root
pnpm --filter @questkit/embed build               # build the IIFE bundle (only needed once)
pnpm --filter @questkit/playground dev            # copies dist + starts wrangler dev
# -> open http://127.0.0.1:8787/index.html
```

The `dev` / `build` / `deploy` scripts all invoke `scripts/copy-embed.mjs`, which
copies `../../packages/embed/dist/questkit.iife.js` into `public/` before Wrangler
boots. Turborepo's `dependsOn: ["^build"]` ensures the embed dist is fresh.

## Minting a JWT for live API calls

The playground HTML files hard-code a placeholder token:

```html
<meta name="questkit-token" content="REPLACE_WITH_MINTED_JWT" />
```

The playground itself is a static testbed — it does not mint tokens. To exercise
live API calls against `api.questkit.jairukchan.com`, mint a short-lived JWT from
the api worker and paste it into the meta tag locally (do **not** commit the real
token — the repo is public):

```bash
curl -sS -X POST https://api.questkit.jairukchan.com/v1/auth/token \
  -H "content-type: application/json" \
  -d '{
        "appId": "playground-demo",
        "appSecret": "<set via wrangler secret put APP_SECRET>",
        "userId": "usr_demo"
      }' | jq -r .token
```

The returned token is valid for 1 h. Swap it into the local copy of
`public/index.html` (or `wordpress.html`) and reload.

## Deployment

Custom-domain wiring for `play.questkit.jairukchan.com` lands in **TASK-030**
(Phase 6, multi-Worker deploy + DNS). Until then, dry-run safely:

```bash
pnpm --filter @questkit/playground deploy:dry-run
```

## Why static, not Vite

The playground exists to test the **vanilla** embed — the user drops a single
`<script>` tag onto a host page and the widgets render. A static-asset Worker
matches that scenario one-to-one. The richer [demo app](../demo) (Phase 5) shows
the React component library with Vite + Tailwind; the playground deliberately
strips all of that away.

## Files

- `package.json` — workspace deps on `@questkit/embed`, dev-dep on Wrangler + rimraf
- `wrangler.jsonc` — `name: questkit-worker-play`, `[assets] directory: ./public`, `not_found_handling: "404-page"`
- `scripts/copy-embed.mjs` — `fs.copyFileSync` source -> dest with byte-size log; exits 1 with a clear hint if the embed dist is missing
- `public/{index,wordpress,iframe}.html` + `public/style.css` — the three host pages and their shared chrome
- `public/questkit.iife.js` — **generated artifact** (gitignored) copied from `packages/embed/dist`
