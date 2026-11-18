-- Bonificaciones de la cuota del torneo: lo que el club le perdona a un
-- integrante de la cuota de un mes, entera o una parte. Baja la cuota y el
-- total que debe; no es plata que entró, así que no toca ninguna caja. La
-- lectura está en dashboard/src/lib/tournamentFees.ts: nunca baja una cuota
-- por debajo de cero, y no aplica a quien pagó el torneo anticipado.
CREATE TABLE tournament_fee_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL,
  player_id uuid NOT NULL,
  month TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  -- Por qué: una bonificación sin motivo no se puede revisar después.
  reason TEXT NOT NULL CHECK (reason <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Una por mes: una bonificación parcial que crece se corrige, no se suma.
  UNIQUE (team_id, player_id, month),
  FOREIGN KEY (team_id, player_id)
    REFERENCES team_players(team_id, player_id) ON DELETE CASCADE
);

ALTER TABLE tournament_fee_waivers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE tournament_fee_waivers FROM anon, authenticated;
GRANT ALL ON TABLE tournament_fee_waivers TO service_role;

-- Daniel Digangi, ACEMHH C1: la cuota de septiembre entera. En una base sin
-- ese jugador en el equipo no hace nada.
INSERT INTO tournament_fee_waivers (team_id, player_id, month, amount, reason)
SELECT tp.team_id, tp.player_id, '2026-09', 80000, 'Bonificación de la cuota de septiembre'
FROM team_players tp
WHERE tp.team_id = '877af798-ac30-499f-8912-2790eddc7a96'
  AND tp.player_id = '84ec3ebd-ef50-4873-8c77-35f0e2e00b7a';
