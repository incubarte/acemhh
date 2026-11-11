-- A WhatsApp receipt for every payment registered.
--
-- The payment-receipts edge function says what was paid and what is still
-- owed; this migration gives it a log to stay idempotent on, and calls it
-- from a trigger, so every way of registering a payment — dashboard or bot —
-- sends one.

-- One row per (payment, phone). The function claims the row before sending,
-- so a repeated call never messages anybody twice; a failed row is taken again.
-- No foreign key to payments: a payment deleted afterwards keeps its log.
CREATE TABLE IF NOT EXISTS whatsapp_receipts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  payment_id UUID NOT NULL,
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  wa_id TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('self', 'guardian')),
  -- The template's parameters, so the inbox topic can show it as the phone did.
  params JSONB NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  wamid TEXT,
  error TEXT,
  shown_in_topic_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (payment_id, wa_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_receipts_wa_id_idx ON whatsapp_receipts(wa_id);

COMMENT ON TABLE whatsapp_receipts IS
  'Log of the WhatsApp receipts for payments: what each phone was told, and whether Meta took it.';

-- Written only by the edge function, through the service role.
ALTER TABLE whatsapp_receipts ENABLE ROW LEVEL SECURITY;

-- The call. pg_net queues the request and sends it once the insert commits,
-- so a payment rolled back sends nothing. The URL and the secret come from
-- the vault, the same ones the reminders' cron uses; without them (a local
-- stack), nothing is sent.
--
-- Per statement, not per row: a statement inserting more than a handful of
-- payments is a load or a migration, not somebody registering a payment, and
-- must not message every player. Nothing here may make the insert fail.
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION notify_payment_receipts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  base_url TEXT;
  secret TEXT;
  p RECORD;
BEGIN
  IF (SELECT count(*) FROM new_payments) > 5 THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO base_url FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'debt_reminders_secret';
  IF base_url IS NULL OR secret IS NULL THEN
    RETURN NULL;
  END IF;

  FOR p IN SELECT id FROM new_payments LOOP
    PERFORM net.http_post(
      url := base_url || '/functions/v1/payment-receipts',
      headers := jsonb_build_object('content-type', 'application/json', 'x-reminders-secret', secret),
      body := jsonb_build_object('payment_id', p.id),
      timeout_milliseconds := 30000
    );
  END LOOP;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'payment receipts not queued: %', SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION notify_payment_receipts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_whatsapp_receipt ON payments;
CREATE TRIGGER payments_whatsapp_receipt
  AFTER INSERT ON payments
  REFERENCING NEW TABLE AS new_payments
  FOR EACH STATEMENT
  EXECUTE FUNCTION notify_payment_receipts();
