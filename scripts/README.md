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

## backfill-phones.ts

Fills `players.phone` and `players.guardian_phone` from Google Forms CSV exports.

### Usage

```bash
deno run --allow-read --allow-env --allow-net scripts/backfill-phones.ts \
  ~/backfill/inscripcion-nivelatorio.csv \
  ~/backfill/relevamiento-2025.csv \
  ~/backfill/torneo-relampago.csv
```

Reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `supabase/functions/.env`,
resolved relative to the script, so it works from any directory. Variables already
exported in the shell take precedence — that is how you aim a single run at a
different database without editing the env file:

```bash
SUPABASE_URL=https://<proj>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  deno run --allow-read --allow-env --allow-net scripts/backfill-phones.ts <csv>...
```

**Check which database you are pointing at before using `--apply`.**

### Flags

| flag | effect |
|---|---|
| *(none)* | dry run — prints the report, writes nothing |
| `--apply` | write the updates |
| `--overwrite` | also replace phones already stored (default fills only nulls) |
| `--sql` | emit `UPDATE ... WHERE id = ...` instead of writing |
| `--seed` | emit `UPDATE ... WHERE dni = ...`, for `supabase/seed.sql` |

### How it decides

- **Priority order.** CSVs are processed in the order given; the first file with a
  *valid* number for a player wins that field. Validity is per field, so a truncated
  number in a high-priority file falls through to the next source instead of winning.
- **Matching** is by DNI first, then by name as an unordered token set. The forms were
  filled inconsistently ("Nahuel zorrilla", "De Lio, Alejandro", bare "Berko"), so word
  order carries no information. Extra tokens are tolerated in the CSV direction only —
  "Joaquín Hernan Carrascosa" matches "Joaquin Carrascosa", never the reverse — and only
  when exactly one player qualifies.
- **Spelling variants are not bridged.** "Laboratto"/"Laborato" and "Maxi"/"Maximiliano"
  are reported as unmatched with a "did you mean" hint, rather than guessed at. Fix those
  by hand; writing a phone onto the wrong person is worse than leaving a blank.

Always read the dry-run report before `--apply`.

### Adding numbers by hand

For players no export covers, make a CSV with this header — these column names are
what the script looks for:

```
Nombre,Apellido,DNI,CELULAR DEL DEPORTISTA,CELULAR DEL FAMILIAR
```

Only the DNI and one phone column are really needed; DNI is worth including because it
matches exactly and skips the name-token guessing. Leave a phone cell empty to say
nothing about it — an empty value never overwrites and never blocks a later source.

Position the file **first** in the argument list for corrections that should beat the
exports, or **last** to only fill gaps.
