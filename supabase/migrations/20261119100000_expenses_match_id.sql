-- El pago de un partido apunta al partido de la agenda, no a un día suelto.
-- Sigue nombrando al equipo: en un partido entre dos equipos del club, cada
-- uno paga lo suyo y son dos egresos del mismo partido.
ALTER TABLE expenses ADD COLUMN match_id uuid REFERENCES matches(id);
CREATE INDEX expenses_match_id_idx ON expenses(match_id);

-- Los ya registrados: el partido que ese equipo jugó ese día. Ningún equipo
-- juega dos el mismo día, así que no hay a cuál elegir.
UPDATE expenses e
SET match_id = m.id
FROM matches m
WHERE e.concept = 'partidos'
  AND m.played_on = e.match_date
  AND e.team_id IN (m.home_team_id, m.away_team_id);

-- El día lo da el partido.
ALTER TABLE expenses DROP CONSTRAINT expenses_match_date_by_concept;
ALTER TABLE expenses DROP COLUMN match_date;

-- Falla si quedó un pago de partido sin partido: hay que mirarlo a mano.
ALTER TABLE expenses ADD CONSTRAINT expenses_match_by_concept
  CHECK ((concept = 'partidos') = (match_id IS NOT NULL));

-- Y el equipo que paga es uno de los que juegan ese partido.
CREATE OR REPLACE FUNCTION expenses_team_plays_match() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.match_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM matches m
    WHERE m.id = NEW.match_id AND NEW.team_id IN (m.home_team_id, m.away_team_id)
  ) THEN
    RAISE EXCEPTION 'El equipo % no juega el partido %', NEW.team_id, NEW.match_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER expenses_team_plays_match
BEFORE INSERT OR UPDATE OF match_id, team_id ON expenses
FOR EACH ROW EXECUTE FUNCTION expenses_team_plays_match();
