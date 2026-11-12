-- Which Telegram message shows each WhatsApp message in its topic — what the
-- person sent, and the reminders and payment receipts once the topic showed
-- them — so a reaction to it on the phone is posted as a reply to it. What
-- the club wrote from the topic has its own in whatsapp_relay_marks.

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
