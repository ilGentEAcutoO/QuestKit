#!/usr/bin/env bash
set -euo pipefail

# QuestKit interactive setup — walks a fresh forker through creating every
# Cloudflare resource named in docs/CLOUDFLARE_SETUP.md, captures the UUIDs
# into workers/api/wrangler.dev.jsonc (gitignored), and optionally generates
# the three Worker secrets.
#
# Idempotent by design: rerunning skips already-created resources (Cloudflare
# returns an error wrangler prints in plain text; we treat "already exists"
# as success) and refuses to overwrite an existing wrangler.dev.jsonc without
# an explicit "Y" confirmation.

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly API_DEV_CONFIG="${REPO_ROOT}/workers/api/wrangler.dev.jsonc"

readonly D1_NAME="questkit-d1-main"
readonly KV_NAME="questkit-kv-cache"
readonly R2_NAME="questkit-r2-assets"
readonly QUEUE_NAME="questkit-queue-webhooks"
readonly DLQ_NAME="questkit-queue-webhooks-dlq"

readonly API_WORKER="questkit-worker-api"
readonly RELAY_WORKER="questkit-worker-webhook-relay"
readonly DEMO_WORKER="questkit-worker-demo"

color_reset=$'\033[0m'
color_bold=$'\033[1m'
color_green=$'\033[32m'
color_yellow=$'\033[33m'
color_red=$'\033[31m'
color_dim=$'\033[2m'

say()   { printf "%s%s%s\n" "${color_bold}" "$1" "${color_reset}"; }
note()  { printf "%s%s%s\n" "${color_dim}"  "$1" "${color_reset}"; }
warn()  { printf "%s%s%s\n" "${color_yellow}" "$1" "${color_reset}"; }
ok()    { printf "%s%s%s\n" "${color_green}" "$1" "${color_reset}"; }
fail()  { printf "%s%s%s\n" "${color_red}"  "$1" "${color_reset}" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_cmd pnpm
require_cmd openssl
require_cmd awk
require_cmd grep
require_cmd sed

if ! pnpm wrangler --version >/dev/null 2>&1; then
  fail "wrangler is not available via pnpm. Run \`pnpm install\` at the repo root first."
fi

say "QuestKit Cloudflare setup"
note "Repo root: ${REPO_ROOT}"
echo

if ! pnpm wrangler whoami >/dev/null 2>&1; then
  warn "You are not logged in to Cloudflare."
  echo "Run: pnpm wrangler login"
  echo "Then rerun this script."
  exit 1
fi

CF_USER=$(pnpm wrangler whoami 2>/dev/null | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | head -n 1 || true)
if [ -n "${CF_USER}" ]; then
  ok "Logged in as: ${CF_USER}"
else
  ok "Logged in (couldn't parse email — non-fatal)."
fi
echo

# ---- Prompts -----------------------------------------------------------------

read -r -p "Cloudflare Account ID (find via \`pnpm wrangler whoami\`): " ACCOUNT_ID
[ -n "${ACCOUNT_ID}" ] || fail "Account ID is required."

read -r -p "Custom domain root (leave blank for *.workers.dev): " CUSTOM_DOMAIN
read -r -p "Generate Worker secrets now (openssl rand)? [Y/n] " GEN_SECRETS_ANSWER
GEN_SECRETS_ANSWER=${GEN_SECRETS_ANSWER:-Y}
case "${GEN_SECRETS_ANSWER}" in
  [Yy]*) GEN_SECRETS=1 ;;
  *)     GEN_SECRETS=0 ;;
esac
echo

# ---- Guard against overwriting an existing dev config ------------------------

if [ -f "${API_DEV_CONFIG}" ]; then
  warn "${API_DEV_CONFIG} already exists."
  read -r -p "Overwrite it? (your existing UUIDs will be lost) [y/N] " OVERWRITE
  case "${OVERWRITE}" in
    [Yy]*) ok "Overwriting on confirmation." ;;
    *)     fail "Aborted. Edit the file manually or delete it before rerunning." ;;
  esac
fi

# ---- Resource creation -------------------------------------------------------
# Cloudflare's CLI returns non-zero for "already exists" — we capture the
# output, log it, and try to parse a UUID even when the create itself failed
# (which happens when the resource is already there). The user can also just
# rerun and reuse existing resources without seeing any error.

run_create() {
  local label="$1"; shift
  local output
  if output=$("$@" 2>&1); then
    printf "%s\n" "${output}"
    return 0
  else
    if printf "%s" "${output}" | grep -qiE "already exists|already in use"; then
      warn "${label}: already exists — reusing."
      printf "%s\n" "${output}"
      return 0
    fi
    printf "%s%s%s\n" "${color_red}" "${output}" "${color_reset}" >&2
    return 1
  fi
}

say "Step 1/5 — Create D1 database (${D1_NAME})"
D1_OUTPUT=$(run_create "${D1_NAME}" pnpm wrangler d1 create "${D1_NAME}") \
  || fail "Failed to create D1 database."

D1_UUID=$(printf "%s" "${D1_OUTPUT}" \
  | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' \
  | head -n 1 || true)

if [ -z "${D1_UUID}" ]; then
  warn "Could not auto-detect D1 UUID. Look at the output above and:"
  read -r -p "  Paste the database_id: " D1_UUID
fi
ok "D1 UUID: ${D1_UUID}"
echo

say "Step 2/5 — Create KV namespace (${KV_NAME})"
KV_OUTPUT=$(run_create "${KV_NAME}" pnpm wrangler kv namespace create "${KV_NAME}") \
  || fail "Failed to create KV namespace."

# wrangler prints `id = "<hex>"` — the namespace id is a 32-char hex blob,
# different shape from a D1/queue UUID.
KV_ID=$(printf "%s" "${KV_OUTPUT}" \
  | grep -oE 'id = "[^"]+"' \
  | head -n 1 \
  | sed -E 's/^id = "([^"]+)"$/\1/' || true)

if [ -z "${KV_ID}" ]; then
  warn "Could not auto-detect KV namespace ID. Look at the output above and:"
  read -r -p "  Paste the id value: " KV_ID
fi
ok "KV ID: ${KV_ID}"
echo

say "Step 3/5 — Create R2 bucket (${R2_NAME})"
run_create "${R2_NAME}" pnpm wrangler r2 bucket create "${R2_NAME}" \
  || fail "Failed to create R2 bucket."
ok "R2 bucket ready (addressed by name; no UUID)."
echo

say "Step 4/5 — Create queues (${QUEUE_NAME} + ${DLQ_NAME})"
run_create "${QUEUE_NAME}" pnpm wrangler queues create "${QUEUE_NAME}" \
  || fail "Failed to create main queue."
run_create "${DLQ_NAME}" pnpm wrangler queues create "${DLQ_NAME}" \
  || fail "Failed to create DLQ."
ok "Queues ready (addressed by name; no UUID)."
echo

# ---- Write wrangler.dev.jsonc ------------------------------------------------

say "Step 5/5 — Writing ${API_DEV_CONFIG}"

ROUTES_BLOCK=""
if [ -n "${CUSTOM_DOMAIN}" ]; then
  ROUTES_BLOCK=$(cat <<EOF

  "routes": [
    { "pattern": "api.${CUSTOM_DOMAIN}", "custom_domain": true }
  ],
EOF
  )
fi

cat > "${API_DEV_CONFIG}" <<EOF
{
  "\$schema": "node_modules/wrangler/config-schema.json",
  "name": "${API_WORKER}",
  "main": "src/index.ts",
  "compatibility_date": "2026-05-19",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
${ROUTES_BLOCK}
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "${D1_NAME}",
      "database_id": "${D1_UUID}"
    }
  ],
  "kv_namespaces": [{ "binding": "CACHE", "id": "${KV_ID}" }],
  "r2_buckets": [
    { "binding": "ASSETS_R2", "bucket_name": "${R2_NAME}" }
  ],

  "queues": {
    "producers": [
      { "binding": "WEBHOOK_QUEUE", "queue": "${QUEUE_NAME}" }
    ]
  },

  "durable_objects": {
    "bindings": [
      { "name": "RATE_LIMITER", "class_name": "RateLimiter" },
      { "name": "SSE_HUB", "class_name": "SSEHub" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["RateLimiter", "SSEHub"] }
  ],

  "analytics_engine_datasets": [
    { "binding": "EVENTS_AE", "dataset": "questkit_events" }
  ],

  "ai": { "binding": "AI" }
}
EOF

ok "Wrote ${API_DEV_CONFIG}"
echo

# ---- Secrets -----------------------------------------------------------------

if [ "${GEN_SECRETS}" -eq 1 ]; then
  say "Generating and setting Worker secrets"
  note "Values are piped via stdin to wrangler — cleartext never lands on disk."

  # JWT_SECRET — api only.
  openssl rand -base64 48 | pnpm wrangler secret put JWT_SECRET --name "${API_WORKER}" >/dev/null
  ok "JWT_SECRET set on ${API_WORKER}"

  # APP_SECRET — api + demo (must match).
  APP_SECRET_VALUE=$(openssl rand -base64 48)
  printf "%s" "${APP_SECRET_VALUE}" | pnpm wrangler secret put APP_SECRET --name "${API_WORKER}" >/dev/null
  printf "%s" "${APP_SECRET_VALUE}" | pnpm wrangler secret put APP_SECRET --name "${DEMO_WORKER}" >/dev/null
  unset APP_SECRET_VALUE
  ok "APP_SECRET set on ${API_WORKER} and ${DEMO_WORKER} (matched)"

  # WEBHOOK_HMAC_SECRET — api + webhook-relay (must match).
  WEBHOOK_SECRET_VALUE=$(openssl rand -base64 48)
  printf "%s" "${WEBHOOK_SECRET_VALUE}" | pnpm wrangler secret put WEBHOOK_HMAC_SECRET --name "${API_WORKER}" >/dev/null
  printf "%s" "${WEBHOOK_SECRET_VALUE}" | pnpm wrangler secret put WEBHOOK_HMAC_SECRET --name "${RELAY_WORKER}" >/dev/null
  unset WEBHOOK_SECRET_VALUE
  ok "WEBHOOK_HMAC_SECRET set on ${API_WORKER} and ${RELAY_WORKER} (matched)"
  echo
else
  warn "Skipping secret generation."
  note "When you're ready, run the openssl|wrangler-secret commands from docs/CLOUDFLARE_SETUP.md step 5."
  echo
fi

# ---- Summary -----------------------------------------------------------------

say "Setup complete."
echo
echo "Next:"
echo "  1) Apply D1 migrations:"
echo "       pnpm --filter @questkit/worker-api db:migrate:remote"
echo "  2) Deploy the api Worker:"
echo "       pnpm --filter @questkit/worker-api deploy"
if [ -n "${CUSTOM_DOMAIN}" ]; then
echo "  3) Wait ~150 s for TLS, then verify:"
echo "       curl https://api.${CUSTOM_DOMAIN}/v1/health"
else
echo "  3) Verify (URL is printed by \`wrangler deploy\`):"
echo "       curl https://${API_WORKER}.<your-subdomain>.workers.dev/v1/health"
fi
echo
echo "Account ID stored for reference: ${ACCOUNT_ID}"
note "Tip: set CLOUDFLARE_ACCOUNT_ID in your environment to skip the account picker on subsequent deploys."
