-- Add player_type with a temporary default to backfill existing rows
ALTER TABLE players
ADD COLUMN player_type TEXT NOT NULL DEFAULT 'player'
CHECK (player_type IN ('player', 'goalkeeper'));

-- Remove the default so future inserts must specify player_type explicitly
ALTER TABLE players ALTER COLUMN player_type DROP DEFAULT;

-- Add trains flag; backfill existing rows as true, then drop default
ALTER TABLE players
ADD COLUMN trains BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE players ALTER COLUMN trains DROP DEFAULT;

-- Add scholarship as a percentage (0 = no scholarship, 100 = full scholarship)
ALTER TABLE players
ADD COLUMN scholarship INTEGER NOT NULL DEFAULT 0
CHECK (scholarship >= 0 AND scholarship <= 100);

-- Set scholarship holders
UPDATE players SET scholarship = 100
WHERE (name = 'David' AND last_name = 'Vlasyk')
   OR (name = 'Nazareno' AND last_name = 'Mamani')
   OR (name = 'Nahuel' AND last_name = 'Zorrilla');

UPDATE players SET scholarship = 20
WHERE name = 'Milo' AND last_name = 'Burgess-Webb';

UPDATE players SET scholarship = 40
WHERE name = 'Benicio' AND last_name = 'Burgess-Webb';

-- Set players that don't train
UPDATE players SET trains = false
WHERE (name = 'Maximiliano' AND last_name = 'Cersosimo')
   OR (name = 'Luciana' AND last_name = 'Lach')
   OR (name = 'Luciano' AND last_name = 'Naredo')
   OR (name = 'Luca' AND last_name = 'Thompson')
   OR (name = 'Leila' AND last_name = 'Aguirre')
   OR (name = 'Nicolas' AND last_name = 'Ocampo')
   OR (name = 'Martin' AND last_name = 'Britos');
