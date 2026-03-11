#!/usr/bin/env bash
set -euo pipefail

# Sets up a cloudflared quick tunnel, updates Telegram bot webhook, and modifies the .env file

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/supabase/functions/.env"

# Check if cloudflared is installed
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "Error: cloudflared not found. Install it first:"
  echo "  brew install cloudflared"
  echo "  or visit: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

# Check if env file exists
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: Env file not found: $ENV_FILE"
  exit 1
fi

# Load TELEGRAM_BOT_TOKEN from env file
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not found in $ENV_FILE"
  exit 1
fi

echo "Starting cloudflared tunnel..."

# Start cloudflared in the background and capture output
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

echo "Tunnel URL: $TUNNEL_URL"

# Extract domain without https:// for BotFather
DOMAIN_ONLY="${TUNNEL_URL#https://}"

echo ""
echo "=========================================="
echo "IMPORTANT: Set domain in BotFather"
echo "=========================================="
echo "1. Open Telegram and start a chat with @BotFather"
echo "2. Send the command: /setdomain"
echo "3. Select your bot from the list"
echo "4. Send this domain: $DOMAIN_ONLY"
echo ""
echo "This links your Mini App domain with your bot."
echo "=========================================="
echo ""
read -p "Press Enter once you've completed the BotFather setup..."

# Update DASHBOARD_URL in .env file
echo "Updating DASHBOARD_URL in $ENV_FILE"

if grep -q "^DASHBOARD_URL=" "$ENV_FILE"; then
  # Replace existing DASHBOARD_URL using a temp file
  TEMP_FILE=$(mktemp)
  sed "s|^DASHBOARD_URL=.*|DASHBOARD_URL=${TUNNEL_URL}|" "$ENV_FILE" > "$TEMP_FILE"
  cat "$TEMP_FILE" > "$ENV_FILE"
  rm -f "$TEMP_FILE"
  echo "✓ Updated existing DASHBOARD_URL"
else
  # Append DASHBOARD_URL if it doesn't exist
  echo "DASHBOARD_URL=${TUNNEL_URL}" >> "$ENV_FILE"
  echo "✓ Added DASHBOARD_URL to .env"
fi

echo ""
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo "Tunnel URL: $TUNNEL_URL"
echo "Mini App Domain: $TUNNEL_URL"
echo "Cloudflared PID: $CLOUDFLARED_PID"
echo ""
echo "The tunnel is running in the background."
echo "To stop it, run: kill $CLOUDFLARED_PID"
echo "=========================================="

# Clean up temp log
rm -f "$TUNNEL_LOG"

# Keep the script running to show the PID
echo ""
echo "Press Ctrl+C to stop monitoring (tunnel will continue running)"
echo "Monitoring cloudflared process..."

# Monitor the process
while kill -0 $CLOUDFLARED_PID 2>/dev/null; do
  sleep 5
done

echo "Cloudflared tunnel has stopped."
