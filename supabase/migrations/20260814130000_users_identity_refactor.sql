-- users become club identities instead of Telegram accounts: a new uuid PK,
-- Telegram-specific columns prefixed tg_ and made optional, and group
-- membership moved here from the code-side USER_GROUPS map (uuid keys are
-- per-database, so code can no longer hardcode identities). This enables
-- admins without Telegram, who log in through the WhatsApp magic link.

-- Login tokens reference users and are short-lived; dropping them loses
-- nothing and frees the FK for the PK swap. The column comes back as uuid.
TRUNCATE whatsapp_login_tokens;
ALTER TABLE whatsapp_login_tokens DROP CONSTRAINT whatsapp_login_tokens_user_id_fkey;
ALTER TABLE whatsapp_login_tokens DROP COLUMN user_id;

ALTER TABLE users RENAME COLUMN id TO tg_id;
ALTER TABLE users RENAME COLUMN username TO tg_username;
ALTER INDEX idx_users_username RENAME TO idx_users_tg_username;

ALTER TABLE users DROP CONSTRAINT users_pkey;
ALTER TABLE users ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users ADD PRIMARY KEY (id);
ALTER TABLE users ALTER COLUMN tg_id DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_tg_id_key UNIQUE (tg_id);

ALTER TABLE users ADD COLUMN groups TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE users ADD CONSTRAINT users_groups_valid CHECK (groups <@ ARRAY['ROOT', 'WHEEL']);

-- Backfill membership from the USER_GROUPS map this replaces.
UPDATE users SET groups = '{ROOT}'
WHERE tg_id IN (45669763, 40541227);
UPDATE users SET groups = '{WHEEL}'
WHERE tg_id IN (179767949, 1239620360, 1388664237, 6885365547, 8025956878, 6776491427, 8958438803);

ALTER TABLE whatsapp_login_tokens
ADD COLUMN user_id uuid NOT NULL REFERENCES users(id);

COMMENT ON TABLE users IS
  'Club identities (admins). tg_* columns hold the optional Telegram binding; phone binds WhatsApp. groups drives the dashboard ACL.';
