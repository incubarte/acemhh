-- Thursday-morning debt reminders over WhatsApp.
--
-- The debt-reminders edge function decides who owes and sends the template;
-- this migration gives it a log to stay idempotent on, and schedules it.

-- One row per (day, player, phone). A run claims the row before sending, so a
-- retried run never messages anybody twice; a failed row is taken again.
CREATE TABLE IF NOT EXISTS whatsapp_reminders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sent_on DATE NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  wa_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('self', 'guardian')),
  -- What the player owed when the reminder went out, as the message said it.
  closed_debt INTEGER NOT NULL,
  month_debt INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  wamid TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sent_on, player_id, wa_id)
);

COMMENT ON TABLE whatsapp_reminders IS
  'Log of the Thursday debt reminders: what each phone was told, and whether Meta took it.';

-- Written only by the edge function, through the service role.
ALTER TABLE whatsapp_reminders ENABLE ROW LEVEL SECURITY;

-- The schedule. pg_cron runs in UTC; Buenos Aires is UTC-3 all year, so 11:00
-- UTC is 8am there. It fires every Thursday, and the function itself checks
-- that the day has training — days off live in training_sessions, not here.
--
-- The URL and the secret differ per environment and are not for a migration
-- to hold: they come from the vault, loaded by hand (docs/whatsapp-setup.md).
-- Until they are, the job runs and posts nowhere.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

SELECT cron.schedule(
  'debt-reminders',
  '0 11 * * 4',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
      || '/functions/v1/debt-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-reminders-secret',
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'debt_reminders_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'project_url')
  $$
);
