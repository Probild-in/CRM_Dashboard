#!/usr/bin/env bash
#
# Prints the three Railway variable blocks, filled in from apps/api/.env.
#
# Output contains live secrets — it is meant to go from your terminal straight
# into Railway's Raw Editor. Do not paste it into a chat, an issue, or a commit.
#
#   ./scripts/railway-env.sh              # all three services
#   ./scripts/railway-env.sh api          # just one
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/apps/api/.env"

[ -f "$ENV_FILE" ] || { echo "Not found: $ENV_FILE" >&2; exit 1; }

get() {
  local key="$1" line value
  line="$(grep -m1 "^${key}=" "$ENV_FILE" || true)"
  value="${line#*=}"
  value="${value%\"}"; value="${value#\"}"
  printf '%s' "$value"
}

DB_URL="$(get DATABASE_URL)"
SUPABASE_URL="$(get SUPABASE_URL)"
PUBLISHABLE="$(get SUPABASE_PUBLISHABLE_KEY)"
SECRET="$(get SUPABASE_SECRET_KEY)"
ENC_KEY="$(get ENCRYPTION_KEY)"
TZ_="$(get DEFAULT_TIMEZONE)"
CUR="$(get DEFAULT_CURRENCY)"

for required in DB_URL SUPABASE_URL PUBLISHABLE SECRET ENC_KEY; do
  [ -n "${!required}" ] || { echo "Missing $required in $ENV_FILE" >&2; exit 1; }
done

case "$DB_URL" in
  *:6543/*) echo "WARNING: DATABASE_URL uses port 6543 (transaction pooler)." >&2
            echo "         Use the session pooler on 5432 — 6543 breaks interactive transactions." >&2 ;;
esac

want() { [ $# -eq 0 ] || [ "${1:-}" = "${SERVICE:-}" ]; }
SERVICE="${1:-}"

cat <<EOF
###############################################################
# Probild CRM — single Railway service
# Paste into: Railway → your service → Variables → Raw Editor
###############################################################
NODE_ENV=production
LOG_LEVEL=info

DATABASE_URL=$DB_URL
DIRECT_DATABASE_URL=$DB_URL

SUPABASE_URL=$SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE
SUPABASE_SECRET_KEY=$SECRET
SUPABASE_STORAGE_BUCKET=probild-documents

ENCRYPTION_KEY=$ENC_KEY

REDIS_URL=\${{Redis.REDIS_URL}}

# One process serves the API, the built client, and the automation worker.
SERVE_WEB=true
WEB_DIST_DIR=../web/dist
RUN_WORKER=true

# Same origin, so the browser calls /api on the host it loaded from.
VITE_SUPABASE_URL=$SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY=$PUBLISHABLE
VITE_API_BASE_URL=

CORS_ORIGINS=https://REPLACE-WITH-YOUR-RAILWAY-DOMAIN.up.railway.app
DEFAULT_TIMEZONE=${TZ_:-Asia/Kolkata}
DEFAULT_CURRENCY=${CUR:-INR}
MAX_UPLOAD_MB=20

SEED_ADMIN_EMAIL=admin@probild.local
SEED_ADMIN_PASSWORD=REPLACE-WITH-A-STRONG-PASSWORD
SEED_ADMIN_FIRST_NAME=Probild
SEED_ADMIN_LAST_NAME=Admin
EOF

cat >&2 <<'EOF'

Two values still need replacing by hand:
  CORS_ORIGINS         your Railway domain, with https://, no trailing slash
  SEED_ADMIN_PASSWORD  a strong password you choose

Do not set PORT (Railway injects it) or TEST_DATABASE_URL (tests only).
Keep the service at ONE replica while RUN_WORKER=true, or scheduled scans
will fire once per replica.
EOF
