#!/usr/bin/env bash
set -euo pipefail

# Starts telegram webhook and dashboard with colored output

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBHOOK_ENV_FILE="$REPO_ROOT/supabase/functions/.env"
DASHBOARD_ENV_FILE="${DASHBOARD_ENV_FILE:-$REPO_ROOT/dashboard/.env.local}"

# Color codes
COLOR_WEBHOOK="\033[0;36m"  # Cyan for webhook
COLOR_DASHBOARD="\033[0;33m" # Yellow for dashboard
COLOR_RESET="\033[0m"

# PIDs to track
CLOUDFLARED_PID=""
WEBHOOK_PID=""
DASHBOARD_PID=""

# Recursively kill a process and all its descendants (children first)
kill_tree() {
  local pid=$1
  local sig=${2:-TERM}
  # Find all children of this PID
  local children
  children=$(ps -ax -o ppid=,pid= | awk -v ppid="$pid" '$1 == ppid {print $2}')
  for child in $children; do
    kill_tree "$child" "$sig"
  done
  kill -"$sig" "$pid" 2>/dev/null || true
}

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down processes..."
  
  if [ -n "$WEBHOOK_PID" ] && kill -0 "$WEBHOOK_PID" 2>/dev/null; then
    echo "Stopping telegram webhook..."
    kill_tree "$WEBHOOK_PID"
  fi
  
  if [ -n "$DASHBOARD_PID" ] && kill -0 "$DASHBOARD_PID" 2>/dev/null; then
    echo "Stopping dashboard..."
    kill_tree "$DASHBOARD_PID"
  fi
  
  if [ -n "$CLOUDFLARED_PID" ] && kill -0 "$CLOUDFLARED_PID" 2>/dev/null; then
    echo "Stopping cloudflared tunnel..."
    kill_tree "$CLOUDFLARED_PID"
  fi
  
  # Wait a moment for graceful shutdown
  sleep 1
  
  # Force kill any survivors
  for pid in $WEBHOOK_PID $DASHBOARD_PID $CLOUDFLARED_PID; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill_tree "$pid" 9
    fi
  done
  
  # Wait for processes to exit
  wait 2>/dev/null || true
  
  echo "All processes stopped."
  exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM EXIT

# Check dependencies
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Error: cloudflared not found. Install it first:"
  echo "  brew install cloudflared"
  echo "  or visit: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

if ! command -v deno >/dev/null 2>&1; then
  echo "Error: deno not found. Install it first: https://deno.com/manual/getting_started/installation"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Error: npm not found. Install Node.js first."
  exit 1
fi

# Check webhook env file
if [ ! -f "$WEBHOOK_ENV_FILE" ]; then
  echo "Error: Webhook env file not found: $WEBHOOK_ENV_FILE"
  exit 1
fi

# Load webhook env vars
set -a
# shellcheck disable=SC1090
source "$WEBHOOK_ENV_FILE"
set +a

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found in $WEBHOOK_ENV_FILE"
  exit 1
fi

# Default operation mode to getUpdates
: "${TELEGRAM_OPERATION_MODE:=getUpdates}"
export TELEGRAM_OPERATION_MODE

echo "=========================================="
echo "Setting up Cloudflared Tunnel"
echo "=========================================="
echo ""

# Start cloudflared tunnel
echo "Starting cloudflared tunnel..."
TUNNEL_LOG=$(mktemp)
cloudflared tunnel --url http://localhost:3000 > "$TUNNEL_LOG" 2>&1 &
CLOUDFLARED_PID=$!

# Wait for the tunnel URL to appear in the log
echo "Waiting for tunnel URL..."
TUNNEL_URL=""
for i in {1..30}; do
  if grep -q "https://.*\.trycloudflare\.com" "$TUNNEL_LOG"; then
    TUNNEL_URL=$(grep -o "https://[^[:space:]]*\.trycloudflare\.com" "$TUNNEL_LOG" | head -1)
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "Error: Failed to extract tunnel URL from cloudflared output"
  cat "$TUNNEL_LOG"
  kill $CLOUDFLARED_PID 2>/dev/null || true
  rm -f "$TUNNEL_LOG"
  exit 1
fi

echo "✓ Tunnel URL: $TUNNEL_URL"
rm -f "$TUNNEL_LOG"

# Extract domain without https:// for BotFather
DOMAIN_ONLY="${TUNNEL_URL#https://}"

# Update DASHBOARD_URL in .env file
echo "Updating DASHBOARD_URL in $WEBHOOK_ENV_FILE"

if grep -q "^DASHBOARD_URL=" "$WEBHOOK_ENV_FILE"; then
  # Replace existing DASHBOARD_URL using a temp file
  TEMP_FILE=$(mktemp)
  sed "s|^DASHBOARD_URL=.*|DASHBOARD_URL=${TUNNEL_URL}|" "$WEBHOOK_ENV_FILE" > "$TEMP_FILE"
  cat "$TEMP_FILE" > "$WEBHOOK_ENV_FILE"
  rm -f "$TEMP_FILE"
  echo "✓ Updated existing DASHBOARD_URL"
else
  # Append DASHBOARD_URL if it doesn't exist
  echo "DASHBOARD_URL=${TUNNEL_URL}" >> "$WEBHOOK_ENV_FILE"
  echo "✓ Added DASHBOARD_URL to .env"
fi

# Reload env vars after updating
set -a
# shellcheck disable=SC1090
source "$WEBHOOK_ENV_FILE"
set +a

echo ""
echo "=========================================="
echo "Starting Telegram Webhook and Dashboard"
echo "=========================================="
echo ""

# Start telegram webhook
echo "Starting telegram webhook (mode=$TELEGRAM_OPERATION_MODE)..."
WEBHOOK_ENTRYPOINT="$REPO_ROOT/supabase/functions/telegram-webhook/index.ts"

# Start in new process group (macOS compatible)
(
  set -m  # Enable job control to create process group
  while IFS= read -r line; do
    echo -e "${COLOR_WEBHOOK}[WEBHOOK]${COLOR_RESET} $line"
  done < <(deno run -A --env-file="$WEBHOOK_ENV_FILE" "$WEBHOOK_ENTRYPOINT" 2>&1)
) &
WEBHOOK_PID=$!

# Give webhook a moment to start
sleep 2

# Start dashboard
echo "Starting dashboard..."
cd "$REPO_ROOT/dashboard"

# Start in new process group (macOS compatible)
(
  set -m  # Enable job control to create process group
  while IFS= read -r line; do
    echo -e "${COLOR_DASHBOARD}[DASHBOARD]${COLOR_RESET} $line"
  done < <(npm run dev 2>&1)
) &
DASHBOARD_PID=$!

# Recursive function to print process tree (macOS compatible)
print_tree() {
  local parent_pid=$1
  local indent=$2
  # Get children of this PID
  local children
  children=$(ps -ax -o ppid=,pid=,command= | awk -v ppid="$parent_pid" '$1 == ppid { $1=""; print }')
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    local child_pid
    child_pid=$(echo "$line" | awk '{print $1}')
    local child_cmd
    child_cmd=$(echo "$line" | awk '{$1=""; print $0}' | sed 's/^ //')
    echo "${indent}├─ [${child_pid}] ${child_cmd}"
    print_tree "$child_pid" "${indent}│  "
  done <<< "$children"
}

# Wait for subprocesses to fully start before printing tree
sleep 4

echo ""
echo "=========================================="
echo "All processes started"
echo "=========================================="
echo ""
echo "Process tree:"
echo ""

if command -v pstree >/dev/null 2>&1; then
  pstree $$
else
  SELF_CMD=$(ps -p $$ -o command= 2>/dev/null || echo "setup-cloudflared-tunnel.sh")
  echo "[$$] $SELF_CMD"
  print_tree $$ "  "
fi

echo ""
echo "=========================================="
echo "IMPORTANT: Set domain in BotFather"
echo "=========================================="
echo "1. Open Telegram and start a chat with @BotFather"
echo "2. Send the command: /setdomain"
echo "3. Select your bot from the list"
echo "4. Send this domain: $DOMAIN_ONLY"
echo ""
echo ""
echo "Press Ctrl+C to stop all processes"
echo ""

# Wait for all processes
wait
