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
| `--roster-only` | read only `id/name/last_name/dni`, ignoring the phone columns |

### How it decides

- **Priority order.** CSVs are processed in the order given; the first file with a
  *valid* number for a player wins that field. Validity is per field, so a truncated
  number in a high-priority file falls through to the next source instead of winning.
- **Matching** is by DNI first, then by name as an unordered token set. The forms were
  filled inconsistently ("Nahuel zorrilla", "De Lio, Alejandro", bare "Berko"), so word
  order carries no information. Extra tokens are tolerated in the CSV direction only —
  "Joaquín Hernan Carrascosa" matches "Joaquin Carrascosa", never the reverse — and only
  when exactly one player qualifies.
- **Guardian vs emergency contact.** `guardian_phone` comes from an explicit
  `madre/padre/tutor` column. The relevamiento export's "CELULAR DEL FAMILAIR" is an
  *emergency contact* and fills `emergency_contact_phone` instead — plus
  `emergency_contact_name` from "NOMBRE DE FAMILIAR DE CONTACTO".
- **Underage players get the emergency number as their guardian too.** Age is taken
  from `players.fecha_nac`, falling back to the CSV's "FECHA NACIMIENTO", and majority
  is 18. Adults never get a guardian derived this way, and neither does a player whose
  birth date is missing or unparsable. An explicit `madre/padre/tutor` column always
  wins over the derived value.
- **Spelling variants are not bridged.** "Laboratto"/"Laborato" and "Maxi"/"Maximiliano"
  are reported as unmatched with a "did you mean" hint, rather than guessed at. Fix those
  by hand; writing a phone onto the wrong person is worse than leaving a blank.

Always read the dry-run report before `--apply`.

### Adding numbers by hand

For players no export covers, make a CSV with this header — these column names are
what the script looks for:

```
Nombre,Apellido,DNI,FECHA NACIMIENTO,CELULAR DEL DEPORTISTA,CELULAR MADRE/PADRE/TUTOR,NOMBRE DE FAMILIAR DE CONTACTO,CELULAR DEL FAMILIAR
```

Only the DNI and one phone column are really needed; DNI is worth including because it
matches exactly and skips the name-token guessing. Leave a phone cell empty to say
nothing about it — an empty value never overwrites and never blocks a later source.

Position the file **first** in the argument list for corrections that should beat the
exports, or **last** to only fill gaps.

### Running before the migration exists

The phone columns do not have to be present. If `players.phone` is missing the script
falls back to reading the roster alone and says so, which lets you run it against a
database the migrations have not reached yet and still get the real matching report:

```bash
SUPABASE_URL=https://<proj>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
  deno run --allow-read --allow-env --allow-net scripts/backfill-phones.ts \
    backfill/manual-phones.csv backfill/*.csv --sql > backfill.sql
```

`--roster-only` forces that mode without probing first. In either case there is nothing
to compare against, so every matched number is reported as new and `--apply` is refused —
apply `20260805130000_add_phone_to_players.sql` and
`20260806100000_add_emergency_contact_to_players.sql`, then either run that SQL or
re-run with `--apply`.

This is also the quickest way to get an accurate list of players no source covers, which
is what belongs in `manual-phones.csv`.

## find-duplicate-players.ts

Reports players that look like the same person entered twice. **Read-only** — it never
writes, because deciding what to merge needs someone who knows the club.

```bash
deno run --allow-read --allow-env --allow-net scripts/find-duplicate-players.ts
```

Same credential handling as `backfill-phones.ts`: reads `supabase/functions/.env`,
shell variables win.

| flag | effect |
|---|---|
| `--threshold=N` | minimum similarity to report, 0-1 (default `0.62`) |
| `--all` | also list pairs ruled out for having two different DNIs |

### How it decides

Both name fields are merged into a single unordered token set before comparing. That
is what makes it immune to the swapped-columns problem — a surname typed into `name`
produces the same set either way, so `Nahuel/Zorrilla` and `Zorrilla/Nahuel` come out
identical. Comparing the columns separately would miss exactly that case.

From there:

- identical token sets → `1.00`
- one set contained in the other ("Joaquin" vs "Joaquin Hernan") → `0.90`
- otherwise a Dice coefficient over fuzzily matched tokens, which catches typos like
  `Laborato`/`Laboratto` and `Guesso`/`Gesso`

Tokens under 4 characters must match exactly — `ana` and `ema` are one edit apart and
are not the same name.

**Diminutives** are expanded before comparing, so `Maxi`/`Maximiliano` and
`Naza`/`Nazareno` match. The table maps each nickname to *all* the names it could
stand for rather than to one canonical form, because most are ambiguous: `Ale` is
Alejandro or Alejandra. Two tokens match when their expansions overlap, so
`Ale`/`Alejandro` matches while `Alejandro`/`Alejandra` does not. Extend `Nicknames`
in the script freely — a wrong entry costs you a pair to eyeball, not a bad merge.

**Gendered pairs are never treated as typos.** `Daniel`/`Daniela` and
`Alejandro`/`Alejandra` are one edit apart, so plain edit distance paired up fathers
and daughters sharing a surname. A final `-o`/`-a` swap, or a trailing `-a`, now counts
as a real difference. The cost is missing a genuine `Mariano` mistyped as `Mariana`,
which is the cheaper error.

Each pair is annotated with whatever else is suggestive: fields inverted, one row an
invitee and the other a member, one row without a DNI.

**Two different DNIs rules a pair out**, since that is strong evidence of two different
people, and those are listed separately behind `--all`. Rows whose name fields are
blank or whitespace-only get their own section — the trim migration leaves those alone
rather than violating the not-empty constraints.

### What it will not catch

Nicknames outside the `Nicknames` table, and shortenings that are not simple
diminutives. Lower `--threshold` to sweep wider, and expect siblings in the results.
