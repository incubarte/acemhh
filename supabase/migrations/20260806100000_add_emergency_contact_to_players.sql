-- Next-of-kin / emergency contact, recorded for every player regardless of age.
--
-- Distinct from guardian_phone: a guardian is the adult legally responsible for an
-- underage player, an emergency contact is simply who to call. For underage players
-- the two are usually the same number, but they are not the same field and adults
-- have an emergency contact with no guardian.

ALTER TABLE players ADD COLUMN emergency_contact_name TEXT;
ALTER TABLE players ADD COLUMN emergency_contact_phone TEXT;

-- Same wa_id shape as the other phone columns, so every number in the table is
-- normalized the same way.
ALTER TABLE players ADD CONSTRAINT players_emergency_contact_phone_format
  CHECK (emergency_contact_phone IS NULL OR emergency_contact_phone ~ '^[1-9][0-9]{7,14}$');

COMMENT ON COLUMN players.emergency_contact_name IS
  'Name of the next of kin to contact in an emergency.';
COMMENT ON COLUMN players.emergency_contact_phone IS
  'Emergency contact mobile, same wa_id format as players.phone. For underage players this usually matches guardian_phone.';
