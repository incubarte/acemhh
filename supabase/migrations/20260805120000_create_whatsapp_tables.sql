-- WhatsApp Cloud API support tables.
--
-- Unlike Telegram, WhatsApp has no message-editing API and no way to read back a
-- message we sent, so multi-step flows cannot keep their state in the rendered
-- message text (the pattern used by the Telegram bot). State lives here instead.

-- One row per conversation. The 24-hour customer service window bounds how long a
-- flow can stay resumable, so sessions expire on the same clock.
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  wa_id TEXT PRIMARY KEY,
  flow TEXT,
  step TEXT,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_expires_at
  ON whatsapp_sessions(expires_at);

COMMENT ON TABLE whatsapp_sessions IS
  'Server-side conversation state for WhatsApp flows, keyed by wa_id (phone number).';

-- Meta retries webhook deliveries until it gets a 2xx, and retries can arrive while
-- the first delivery is still being processed. Handlers must be idempotent on
-- message id; this table is the guard.
CREATE TABLE IF NOT EXISTS whatsapp_processed_messages (
  message_id TEXT PRIMARY KEY,
  wa_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_processed_messages_processed_at
  ON whatsapp_processed_messages(processed_at);

COMMENT ON TABLE whatsapp_processed_messages IS
  'Deduplication guard for redelivered WhatsApp webhook messages. Safe to prune rows older than a few days.';

-- Both tables are written only by the edge function via the service role.
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_processed_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE whatsapp_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE whatsapp_processed_messages FROM anon, authenticated;

GRANT ALL ON TABLE whatsapp_sessions TO service_role;
GRANT ALL ON TABLE whatsapp_processed_messages TO service_role;
