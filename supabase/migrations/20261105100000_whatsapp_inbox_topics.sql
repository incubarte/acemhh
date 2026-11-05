-- WhatsApp conversations as Telegram forum topics: one topic per phone in the
-- inbox group, opened the first time that phone writes. What the club writes
-- in the topic goes back to the phone.

CREATE TABLE IF NOT EXISTS whatsapp_inbox_topics (
  wa_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  thread_id BIGINT NOT NULL,
  -- The person's last message. Free-form replies are only allowed within 24h
  -- of it (Meta's customer service window); a template does not open it.
  last_inbound_at TIMESTAMPTZ,
  -- The club's last message from the topic. While it is recent, the bot's
  -- automatic status reply stays quiet: a person is answering.
  last_club_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chat_id, thread_id)
);

COMMENT ON TABLE whatsapp_inbox_topics IS
  'Which Telegram forum topic of the inbox group holds the conversation with each WhatsApp number.';

ALTER TABLE whatsapp_inbox_topics ENABLE ROW LEVEL SECURITY;

-- What each reminder said, so the topic can show it exactly as the phone did,
-- and whether it was already shown there. A reminder is shown the first time
-- the person writes after it; nobody answering opens no topic.
ALTER TABLE whatsapp_reminders ADD COLUMN IF NOT EXISTS params JSONB;
ALTER TABLE whatsapp_reminders ADD COLUMN IF NOT EXISTS shown_in_topic_at TIMESTAMPTZ;
