-- A pause on the WhatsApp payment receipts, for trying things out with real
-- payments: until the time it names, a payment sends nobody anything. It
-- ends on its own, so a forgotten pause cannot silence the receipts for good.
-- Payments made during it never get their receipt, by design: they were the
-- test.

CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_settings FROM anon, authenticated;

-- Who paused and resumed, in the activity log.
CREATE TRIGGER app_settings_activity AFTER INSERT OR UPDATE OR DELETE ON app_settings
  FOR EACH ROW EXECUTE FUNCTION log_row_change();

CREATE OR REPLACE FUNCTION notify_payment_receipts()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  base_url TEXT;
  secret TEXT;
  paused_until TIMESTAMPTZ;
  p RECORD;
BEGIN
  IF (SELECT count(*) FROM new_payments) > 5 THEN
    RETURN NULL;
  END IF;

  SELECT (value->>'until')::timestamptz INTO paused_until
    FROM app_settings WHERE key = 'payment_receipts_pause';
  IF paused_until IS NOT NULL AND now() < paused_until THEN
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
