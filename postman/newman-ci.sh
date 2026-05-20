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

# Note: M1 prefire used to be attempted via curl here (and before that as a
# pm.sendRequest IIFE inside the Claim request's pre-request script). Both
# approaches failed:
#   - Pre-request IIFE: Newman doesn't wait for chained pm.sendRequest, so the
#     claim raced ahead and saw an active (not completed) mission → 409.
#   - curl from CI: Cloudflare's bot-management layer 403's bare curl
#     regardless of User-Agent (TLS fingerprint differs from PostmanRuntime).
# Current approach lives in the collection itself: two extra "Fire event"
# requests sit between "Get non-existent mission" and "Claim mission" in the
# Missions folder. Combined with the one purchase.completed already in the
# Events folder, that's 3 unique purchase.completed events before claim, M1
# transitions to `completed`, and claim returns 200.

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
