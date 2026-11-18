-- Los partidos de un torneo: la agenda que publica la liga, sólo con los que
-- juega algún equipo del club.
--
-- Cada lado es un equipo del club o un rival, que no está dado de alta y va
-- por nombre. Un partido entre dos equipos del club es uno solo, con los dos.
-- El día y la hora son los de Buenos Aires, como los publica la liga.
CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  -- El código de la liga: B03, C26...
  code TEXT NOT NULL CHECK (code <> ''),
  played_on DATE NOT NULL,
  starts_at TIME NOT NULL,
  home_team_id uuid REFERENCES teams(id),
  home_name TEXT CHECK (home_name <> ''),
  away_team_id uuid REFERENCES teams(id),
  away_name TEXT CHECK (away_name <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, code),
  FOREIGN KEY (tournament_id, category_id)
    REFERENCES tournament_categories(tournament_id, id),
  -- Cada lado es o un equipo nuestro o un rival por nombre, y al menos uno
  -- es nuestro.
  CHECK ((home_team_id IS NULL) <> (home_name IS NULL)),
  CHECK ((away_team_id IS NULL) <> (away_name IS NULL)),
  CHECK (home_team_id IS NOT NULL OR away_team_id IS NOT NULL),
  CHECK (home_team_id IS DISTINCT FROM away_team_id)
);

CREATE INDEX matches_home_team_id_idx ON matches(home_team_id);
CREATE INDEX matches_away_team_id_idx ON matches(away_team_id);
CREATE INDEX matches_played_on_idx ON matches(played_on);

ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE matches FROM anon, authenticated;
GRANT ALL ON TABLE matches TO service_role;

-- ---------------------------------------------------------------- Clausura 2026
-- La letra de la liga es la categoría: A Elite, B Master, C Senior, D Rookies.
WITH t AS (
  SELECT id FROM tournaments WHERE name = 'Interclubes Clausura 2026'
), cat(letter, id) AS (VALUES
  ('A', '6b1f2c3a-0002-4c26-9a11-000000000001'),
  ('B', '6b1f2c3a-0002-4c26-9a11-000000000002'),
  ('C', '6b1f2c3a-0002-4c26-9a11-000000000003'),
  ('D', '6b1f2c3a-0002-4c26-9a11-000000000004')
)
INSERT INTO matches (tournament_id, category_id, code, played_on, starts_at,
  home_team_id, home_name, away_team_id, away_name)
SELECT t.id, cat.id::uuid, v.code, v.played_on::date, v.starts_at::time,
  v.home_team_id::uuid, v.home_name, v.away_team_id::uuid, v.away_name
FROM t
CROSS JOIN (VALUES
  ('B03', 'B', '2026-09-12', '20:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL),
  ('C03', 'C', '2026-09-14', '21:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, NULL, 'Ovejas Borregos'),
  ('B04', 'B', '2026-09-14', '22:00', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL, NULL, 'Ovejas B'),
  ('B05', 'B', '2026-09-14', '23:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Hazard B'),
  ('A02', 'A', '2026-09-18', '20:00', '550ecc8e-0684-4c36-8bc1-61cc87528d1a', NULL, NULL, 'Cahhl A'),
  ('B06', 'B', '2026-09-19', '20:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Fantasy B'),
  ('C04', 'C', '2026-09-20', '21:00', 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL, NULL, 'Fantasy Devoto'),
  ('C06', 'C', '2026-09-20', '23:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, NULL, 'Winter C'),
  ('B07', 'B', '2026-09-23', '21:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Ovejas B'),
  ('C07', 'C', '2026-09-23', '23:00', 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL, NULL, 'Hazard White'),
  ('B08', 'B', '2026-09-24', '21:00', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL, NULL, 'Winter B'),
  ('A03', 'A', '2026-09-25', '20:00', '550ecc8e-0684-4c36-8bc1-61cc87528d1a', NULL, NULL, 'Cahhl A'),
  ('B10', 'B', '2026-09-26', '20:00', NULL, 'Hazard B', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL),
  ('D03', 'D', '2026-09-29', '23:00', 'a819a1aa-3c6b-4e55-af52-67865214790e', NULL, NULL, 'Fantasy Arenales'),
  ('A04', 'A', '2026-10-09', '20:00', '550ecc8e-0684-4c36-8bc1-61cc87528d1a', NULL, NULL, 'Fantasy A'),
  ('C11', 'C', '2026-10-12', '22:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, NULL, 'Ovejas Carneros'),
  ('B14', 'B', '2026-10-14', '21:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Winter B'),
  ('C13', 'C', '2026-10-14', '22:00', 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL, NULL, 'Cahhl C'),
  ('B15', 'B', '2026-10-15', '21:00', NULL, 'Fantasy B', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL),
  ('D06', 'D', '2026-10-15', '23:00', 'a819a1aa-3c6b-4e55-af52-67865214790e', NULL, NULL, 'Hazard Red'),
  ('A05', 'A', '2026-10-16', '20:00', '550ecc8e-0684-4c36-8bc1-61cc87528d1a', NULL, NULL, 'Fantasy A'),
  ('B17', 'B', '2026-10-20', '21:00', NULL, 'Fantasy B', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL),
  ('B18', 'B', '2026-10-29', '21:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Winter B'),
  ('C17', 'C', '2026-10-29', '23:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, NULL, 'Fantasy Olympia'),
  ('A07', 'A', '2026-10-30', '20:00', '550ecc8e-0684-4c36-8bc1-61cc87528d1a', NULL, NULL, 'Fantasy A'),
  ('B19', 'B', '2026-11-02', '21:00', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL, NULL, 'Ovejas B'),
  ('C19', 'C', '2026-11-02', '22:00', 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL, NULL, 'Ovejas Borregos'),
  ('D07', 'D', '2026-11-02', '23:00', 'a819a1aa-3c6b-4e55-af52-67865214790e', NULL, NULL, 'Ovejas D'),
  ('B20', 'B', '2026-11-05', '21:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Hazard B'),
  ('A08', 'A', '2026-11-06', '20:00', '550ecc8e-0684-4c36-8bc1-61cc87528d1a', NULL, NULL, 'Cahhl A'),
  ('B22', 'B', '2026-11-14', '20:00', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL, NULL, 'Winter B'),
  ('C21', 'C', '2026-11-15', '20:00', 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL, NULL, 'Winter C'),
  ('B24', 'B', '2026-11-17', '21:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL),
  ('C24', 'C', '2026-11-17', '22:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, NULL, 'Cahhl C'),
  ('D10', 'D', '2026-11-17', '23:00', 'a819a1aa-3c6b-4e55-af52-67865214790e', NULL, NULL, 'Winter D'),
  ('B25', 'B', '2026-11-21', '20:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Fantasy B'),
  ('B28', 'B', '2026-12-01', '21:00', 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70', NULL, NULL, 'Ovejas B'),
  ('C26', 'C', '2026-12-01', '22:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL),
  ('B29', 'B', '2026-12-02', '21:00', NULL, 'Hazard B', 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd', NULL),
  ('C29', 'C', '2026-12-03', '23:00', 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL, NULL, 'Fantasy Olympia'),
  ('C30', 'C', '2026-12-08', '22:00', 'ce14d510-b81c-4b4a-b841-8e3453e55177', NULL, NULL, 'Ovejas Carneros'),
  ('C32', 'C', '2026-12-09', '21:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, NULL, 'Hazard White'),
  ('D14', 'D', '2026-12-09', '22:00', 'a819a1aa-3c6b-4e55-af52-67865214790e', NULL, NULL, 'Hazard Blue'),
  ('C35', 'C', '2026-12-13', '22:00', '877af798-ac30-499f-8912-2790eddc7a96', NULL, NULL, 'Fantasy Devoto')

) AS v(code, letter, played_on, starts_at, home_team_id, home_name, away_team_id, away_name)
JOIN cat ON cat.letter = v.letter;
