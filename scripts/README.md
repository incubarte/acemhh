# scripts

## startup-local-env.sh

Sets up a cloudflared tunnel, starts the telegram webhook and the Next.js dashboard in a single terminal with colored output. Press `Ctrl+C` to stop all processes.

### Prereqs

- `cloudflared` installed (`brew install cloudflared`)
- `deno` installed
- `npm` installed

### What it does

1. Starts a cloudflared quick tunnel pointing to `http://localhost:3000`
2. Extracts the tunnel URL and updates `DASHBOARD_URL` in `supabase/functions/.env`
3. Starts the telegram webhook (`deno run`) with cyan `[WEBHOOK]` output
4. Starts the dashboard (`npm run dev`) with yellow `[DASHBOARD]` output
5. Prints the full process tree
6. Shows BotFather domain setup instructions

### Usage

```bash
./scripts/startup-local-env.sh
```

### Env files

- **Webhook**: `supabase/functions/.env`
- **Dashboard**: `dashboard/.env.local`

### Telegram operation mode

You can control webhook vs long-polling via `TELEGRAM_OPERATION_MODE` in `supabase/functions/.env`:

- `getUpdates` (default) — long-polling
- `setWebhook` — webhook mode
