-- Un pago de partido nombra al equipo que jugó. Se registra uno por partido
-- y por equipo: si dos equipos del club juegan entre sí son dos egresos, y
-- si la mesa y la pista se pagan por separado, dos egresos del mismo equipo.
ALTER TABLE expenses ADD COLUMN team_id uuid REFERENCES teams(id);
CREATE INDEX expenses_team_id_idx ON expenses(team_id);

-- NOT VALID: los partidos ya registrados no tienen equipo todavía; se
-- completan a mano y otra migración valida la regla. Las filas nuevas, y
-- cualquier fila que se edite, ya la cumplen desde ahora.
ALTER TABLE expenses ADD CONSTRAINT expenses_team_by_concept
  CHECK ((concept = 'partidos') = (team_id IS NOT NULL)) NOT VALID;
