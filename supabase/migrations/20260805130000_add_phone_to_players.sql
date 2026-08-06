-- Phone numbers for players, stored in the format the WhatsApp Cloud API uses for
-- wa_id: international digits only, no '+', no separators (e.g. 5491134567890).
-- Both are optional; guardian_phone covers underage players.

ALTER TABLE players ADD COLUMN phone TEXT;
ALTER TABLE players ADD COLUMN guardian_phone TEXT;

-- E.164 allows at most 15 digits and never a leading zero.
ALTER TABLE players ADD CONSTRAINT players_phone_format
  CHECK (phone IS NULL OR phone ~ '^[1-9][0-9]{7,14}$');
ALTER TABLE players ADD CONSTRAINT players_guardian_phone_format
  CHECK (guardian_phone IS NULL OR guardian_phone ~ '^[1-9][0-9]{7,14}$');

-- Not unique: siblings share a guardian, and a young player may list a parent's
-- number as their own.
CREATE INDEX IF NOT EXISTS idx_players_phone
  ON players(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_players_guardian_phone
  ON players(guardian_phone) WHERE guardian_phone IS NOT NULL;

COMMENT ON COLUMN players.phone IS
  'Player mobile in WhatsApp wa_id format: international digits only, no + or separators.';
COMMENT ON COLUMN players.guardian_phone IS
  'Parent/guardian mobile, same format. Used when the player is underage.';
