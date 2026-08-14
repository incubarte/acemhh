-- One-time login tokens for admins reaching the dashboard from WhatsApp,
-- meant for admins who do not have Telegram. The webhook mints a token when a
-- known admin greets the bot; the dashboard exchanges it for a session cookie.
--
-- Only the SHA-256 hash is stored, so a leaked table does not leak live links.
-- Rows are single-use (used_at) and short-lived (expires_at). Safe to prune
-- rows past expires_at.
CREATE TABLE IF NOT EXISTS whatsapp_login_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_login_tokens_expires_at
  ON whatsapp_login_tokens(expires_at);

-- Written by the edge function and the dashboard, both via the service role.
ALTER TABLE whatsapp_login_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE whatsapp_login_tokens FROM anon, authenticated;
GRANT ALL ON TABLE whatsapp_login_tokens TO service_role;
