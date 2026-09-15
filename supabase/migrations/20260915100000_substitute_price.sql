-- Los suplentes no tienen cuota: se les puede registrar un pago suelto, y el
-- monto habitual lo dice la categoría del torneo. NULL: sin sugerencia.
ALTER TABLE tournament_categories ADD COLUMN substitute_price NUMERIC
  CHECK (substitute_price > 0);

UPDATE tournament_categories SET substitute_price = 35000
WHERE tournament_id = '6b1f2c3a-0001-4c26-9a11-000000000001';
