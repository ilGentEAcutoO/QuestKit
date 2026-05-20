#!/usr/bin/env bash
# Newman CI runner for QuestKit API. Exits non-zero on any failure.
# Run from repo root: ./postman/newman-ci.sh
# Required env vars: APP_SECRET (the demo-app shared secret used by /v1/auth/token).
# Optional env vars: BASE_URL, APP_ID, USER_ID — defaults below.
set -euo pipefail

BASE_URL="${BASE_URL:-https://api.questkit.jairukchan.com}"
APP_ID="${APP_ID:-demo}"
USER_ID="${USER_ID:-newman_$(date +%s)}"
APP_SECRET="${APP_SECRET:?APP_SECRET env var required}"

echo "[newman] running against $BASE_URL with user $USER_ID"

# Pre-fire setup: complete M1 ("Triple Treat" — 3 purchase.completed events,
# daily window, no filter) before Newman's claim test runs. The original
# attempt put this in the Claim request's pre-request script as a Promise/IIFE,
# but Newman's pre-request scripts don't wait for chained pm.sendRequest
# callbacks — the claim fires before the prefires land, returning 409. Doing
# it here in bash is synchronous: each curl blocks until response, so by the
# time `newman run` starts, M1 is `completed` for $USER_ID and claim succeeds.
echo "[newman] pre-firing 3 purchase.completed events to complete M1 for $USER_ID"
TOKEN=$(curl -fsS -X POST "$BASE_URL/v1/auth/token" \
  -H "content-type: application/json" \
  -d "{\"appId\":\"$APP_ID\",\"appSecret\":\"$APP_SECRET\",\"userId\":\"$USER_ID\"}" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  echo "[newman] FATAL: token mint failed; aborting before Newman run." >&2
  exit 1
fi
NOW_MS=$(($(date +%s) * 1000))
for i in 1 2 3; do
  curl -fsS -o /dev/null -X POST "$BASE_URL/v1/events" \
    -H "content-type: application/json" \
    -H "authorization: Bearer $TOKEN" \
    -H "idempotency-key: ci_prefire_${USER_ID}_${i}" \
    -d "{\"userId\":\"$USER_ID\",\"name\":\"purchase.completed\",\"payload\":{\"amount\":10,\"category\":\"books\"},\"timestamp\":$NOW_MS}" \
    || { echo "[newman] FATAL: prefire event $i failed; aborting." >&2; exit 1; }
done
echo "[newman] prefire complete; starting Newman"
unset TOKEN

# Newman is invoked via npx so we don't need a global install; pinning is via
# `newman@latest` (CI-determinism note: pin a major + minor here if reproducible
# wire-protocol behaviour matters across upgrades — for v0.1.0 we accept the
# latest patch). We also pin Newman's per-request timeout at 10s so the SSE
# handshake (which intentionally streams) doesn't hang the run.
exec npx --yes -p newman@latest newman run \
  ./postman/questkit.postman_collection.json \
  --env-var "base_url=$BASE_URL" \
  --env-var "app_id=$APP_ID" \
  --env-var "app_secret=$APP_SECRET" \
  --env-var "user_id=$USER_ID" \
  --reporters cli,json \
  --reporter-json-export ./postman/newman-report.json \
  --timeout-request 10000 \
  --color on \
  --bail
