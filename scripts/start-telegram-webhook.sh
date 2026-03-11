#!/usr/bin/env bash
set -euo pipefail

# Loads env vars from supabase/functions/.env (or SUPABASE_FUNCTIONS_ENV_FILE) and starts the telegram-webhook function locally.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE_DEFAULT="$REPO_ROOT/supabase/functions/.env"
ENV_FILE="${SUPABASE_FUNCTIONS_ENV_FILE:-$ENV_FILE_DEFAULT}"

if ! command -v deno >/dev/null 2>&1; then
  echo "deno not found. Install it first: https://deno.com/manual/getting_started/installation"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE"
  echo "Create it (you can start from supabase/functions/.env.example) or set SUPABASE_FUNCTIONS_ENV_FILE."
  exit 1
fi

# Export all variables from the env file into the current process.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Default operation mode to getUpdates unless you override it in the env file.
: "${TELEGRAM_OPERATION_MODE:=getUpdates}"
export TELEGRAM_OPERATION_MODE

echo "Starting telegram-webhook (mode=$TELEGRAM_OPERATION_MODE) using env file: $ENV_FILE"

ENTRYPOINT="$REPO_ROOT/supabase/functions/telegram-webhook/index.ts"

exec deno run -A --env-file="$ENV_FILE" "$ENTRYPOINT"
