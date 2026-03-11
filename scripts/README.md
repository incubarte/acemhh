# scripts

## start-telegram-webhook.sh

Starts the local `telegram-webhook` Supabase Edge Function using environment variables loaded from an env file.

### Prereqs

- Supabase CLI installed
- Local Supabase stack running:

```bash
supabase start
```

### Env file

By default it loads:

- `supabase/functions/.env`

Override with:

- `SUPABASE_FUNCTIONS_ENV_FILE=/absolute/path/to/.env`

### Usage

```bash
./scripts/start-telegram-webhook.sh
```

It runs:

```bash
deno run -A --env-file=supabase/functions/.env supabase/functions/telegram-webhook/index.ts
```

You can control webhook vs long-polling with:

- `TELEGRAM_OPERATION_MODE=getUpdates` (default)
- `TELEGRAM_OPERATION_MODE=setWebhook`
