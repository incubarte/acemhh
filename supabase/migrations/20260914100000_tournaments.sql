-- Torneos, equipos y la cuota de participación.
--
-- Un torneo tiene categorías (Elite, Master, Senior, Rookies), y en cada
-- categoría cero o más equipos. Un jugador puede integrar varios equipos, aun
-- del mismo torneo, como titular o suplente. Puede haber varios torneos
-- activos a la vez, o ninguno.
--
-- La cuota se define por categoría del torneo: una cuota por mes, y un precio
-- del torneo entero para quien lo paga todo junto antes de que venza la
-- primera cuota. Los pagos no llevan mes: cada mes es una cuota, se admiten
-- pagos por cualquier monto, y lo que cuenta es cuánto pagó contra cuánto
-- debería llevar pagado. La lectura de eso vive en
-- dashboard/src/lib/tournamentFees.ts.

CREATE TABLE tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (name <> ''),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tournament_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (name <> ''),
  -- El orden en que se listan.
  position INT NOT NULL DEFAULT 0,
  -- Pagar el torneo entero, sin haber pagado nada y antes de que venza la
  -- primera cuota, sale menos que la suma de las cuotas. NULL: sin descuento.
  upfront_price NUMERIC CHECK (upfront_price > 0),
  UNIQUE (tournament_id, name),
  -- Para que un equipo sólo pueda apuntar a una categoría de su propio torneo.
  UNIQUE (tournament_id, id)
);

-- Una fila por mes: lo que hay que llevar pagado al terminar ese mes.
CREATE TABLE tournament_installments (
  category_id uuid NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  PRIMARY KEY (category_id, month)
);

CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  name TEXT NOT NULL CHECK (name <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, name),
  FOREIGN KEY (tournament_id, category_id)
    REFERENCES tournament_categories(tournament_id, id)
);

CREATE INDEX teams_tournament_id_idx ON teams(tournament_id);

CREATE TABLE team_players (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('starter', 'substitute')),
  PRIMARY KEY (team_id, player_id)
);

CREATE INDEX team_players_player_id_idx ON team_players(player_id);

-- ---------------------------------------------------------------- payments
-- La cuota del torneo se cobra por equipo integrado: el pago nombra al equipo.
-- 'tournament' es una cuota o parte de ella; 'tournament upfront' es el torneo
-- entero con descuento, y se distingue porque cambia cuánto es el total.
ALTER TABLE payments ADD COLUMN team_id uuid REFERENCES teams(id);
CREATE INDEX payments_team_id_idx ON payments(team_id);

ALTER TABLE payments DROP CONSTRAINT payments_concept_valid;
ALTER TABLE payments ADD CONSTRAINT payments_concept_valid
  CHECK (concept IN (
    'monthly', 'session', 'membership dues', 'debt settlement', 'half month',
    'tournament', 'tournament upfront'
  ));

ALTER TABLE payments ADD CONSTRAINT payments_team_by_concept
  CHECK (
    (concept IN ('tournament', 'tournament upfront') AND team_id IS NOT NULL)
    OR (concept NOT IN ('tournament', 'tournament upfront') AND team_id IS NULL)
  );

-- Como la cuota social, el torneo no pertenece a ningún slot de entrenamiento.
ALTER TABLE payments DROP CONSTRAINT payments_slot_by_concept;
ALTER TABLE payments ADD CONSTRAINT payments_slot_by_concept
  CHECK (
    (concept IN ('membership dues', 'tournament', 'tournament upfront')
      AND slot_weekday IS NULL AND slot_hour IS NULL)
    OR (concept NOT IN ('membership dues', 'tournament', 'tournament upfront')
      AND slot_weekday IS NOT NULL AND slot_hour IS NOT NULL)
  );

-- Escritas sólo con el service role, como el resto.
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tournaments, tournament_categories, tournament_installments,
  teams, team_players FROM anon, authenticated;
GRANT ALL ON TABLE tournaments, tournament_categories, tournament_installments,
  teams, team_players TO service_role;

-- ---------------------------------------------------------------- Clausura 2026
-- El torneo en curso y su esquema de cuotas. Los equipos y sus jugadores
-- entran con su propia migración cuando estén las listas.
--
-- Las tarifas se acordaron como A/B/C/D; acá quedan mapeadas en el orden de
-- las categorías del torneo (A=Elite, B=Master, C=Senior, D=Rookies). Si el
-- mapeo es otro, es un UPDATE sobre estas filas.
WITH t AS (
  INSERT INTO tournaments (name) VALUES ('Interclubes Clausura 2026') RETURNING id
), cats AS (
  INSERT INTO tournament_categories (tournament_id, name, position, upfront_price)
  SELECT t.id, c.name, c.position, c.upfront_price
  FROM t CROSS JOIN (VALUES
    ('Elite',   1, 178000),
    ('Master',  2, 282000),
    ('Senior',  3, 232000),
    ('Rookies', 4, 151000)
  ) AS c(name, position, upfront_price)
  RETURNING id, name
)
INSERT INTO tournament_installments (category_id, month, amount)
SELECT cats.id, i.month, i.amount
FROM cats JOIN (VALUES
  ('Elite',   '2026-09',  60000), ('Elite',   '2026-10', 55000),
  ('Elite',   '2026-11',  55000), ('Elite',   '2026-12', 25000),
  ('Master',  '2026-09', 100000), ('Master',  '2026-10', 90000),
  ('Master',  '2026-11',  85000), ('Master',  '2026-12', 35000),
  ('Senior',  '2026-09',  80000), ('Senior',  '2026-10', 75000),
  ('Senior',  '2026-11',  70000), ('Senior',  '2026-12', 30000),
  ('Rookies', '2026-09',  50000), ('Rookies', '2026-10', 50000),
  ('Rookies', '2026-11',  45000), ('Rookies', '2026-12', 20000)
) AS i(category, month, amount) ON i.category = cats.name;
