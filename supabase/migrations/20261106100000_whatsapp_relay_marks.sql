-- Which Telegram message each relayed WhatsApp message came from, so Meta's
-- delivery statuses can mark it in the topic: sent, delivered, read — like
-- WhatsApp's own ticks. Only the link and the furthest status; what was said
-- lives in the topic itself.

CREATE TABLE IF NOT EXISTS whatsapp_relay_marks (
  wamid TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE whatsapp_relay_marks IS
  'Telegram message behind each WhatsApp message the club sent from a topic, and how far Meta says it got.';

ALTER TABLE whatsapp_relay_marks ENABLE ROW LEVEL SECURITY;
