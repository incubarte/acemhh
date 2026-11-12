-- Which Telegram message each inbound WhatsApp message became in its topic,
-- so a reaction to it later can be posted as a reply to it. The club's own
-- messages have theirs in whatsapp_relay_marks.

CREATE TABLE IF NOT EXISTS whatsapp_inbox_posts (
  wamid TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE whatsapp_inbox_posts IS
  'Telegram message behind each inbound WhatsApp message posted to the inbox, for answering reactions to it.';

ALTER TABLE whatsapp_inbox_posts ENABLE ROW LEVEL SECURITY;
