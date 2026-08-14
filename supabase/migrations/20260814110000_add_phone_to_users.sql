-- Correlates a dashboard/Telegram admin (users.id) with the WhatsApp sender.
-- wa_id is the sender's phone in E.164 without the +, so a curated phone here
-- is enough to resolve an incoming WhatsApp message to the same identity the
-- dashboard uses. Same normalized format as players.phone.
ALTER TABLE users ADD COLUMN phone TEXT UNIQUE
CHECK (phone IS NULL OR phone ~ '^[1-9][0-9]{7,14}$');

COMMENT ON COLUMN users.phone IS
  'WhatsApp phone (E.164, no +). Links this admin to their wa_id in the WhatsApp webhook. Populated by hand.';
