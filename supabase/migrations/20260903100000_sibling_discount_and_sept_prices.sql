-- Tarifa de septiembre 2026 y descuento por hermanos como monto fijo.
--
-- El descuento por hermanos venía modelado con `players.scholarship` (20% el
-- segundo hermano, 40% el tercero). Con la tarifa vieja daba justo: el mes de
-- 4 sesiones a 25.000 sale 100.000, y el 20% y el 40% dejan 80.000 y 60.000.
-- Con la prepaga en 27.500 el mes sale 110.000 y ningún porcentaje entero da
-- los 90.000, 70.000 y 50.000 que se quieren cobrar.
--
-- Lo que sí cierra, con las dos tarifas, es un descuento FIJO por sesión:
-- cada hermano después del primero descuenta 5.000 por sesión prepaga.
--
--   hermano   antes (25.000)          ahora (27.500)
--   2º        20.000 × 4 =  80.000    22.500 × 4 =  90.000
--   3º        15.000 × 4 =  60.000    17.500 × 4 =  70.000
--   4º        10.000 × 4 =  40.000    12.500 × 4 =  50.000
--
-- El descuento aplica sólo a la tarifa prepaga (mes y medio mes). La sesión
-- individual y los arqueros no cambian. `scholarship` queda para las becas
-- reales.

-- ---------------------------------------------------------------- prices
-- Cuánto descuenta cada hermano después del primero, por sesión prepaga. Vive
-- en prices porque cambia con la tarifa. Se backfillea con 5.000: es lo que
-- valía en los hechos con la tarifa vieja, así los meses cerrados recalculan
-- igual.
ALTER TABLE prices ADD COLUMN sibling_session_discount NUMERIC;
UPDATE prices SET sibling_session_discount = 5000;
ALTER TABLE prices ALTER COLUMN sibling_session_discount SET NOT NULL;
ALTER TABLE prices ADD CONSTRAINT prices_sibling_discount_nonnegative
  CHECK (sibling_session_discount >= 0);

INSERT INTO prices (
  valid_from,
  session_price,
  prepaid_session_price,
  goalkeeper_session_price,
  goalkeeper_invitee_session_price,
  sibling_session_discount
)
VALUES ('2026-09-01', 35000, 27500, 20000, 25000, 5000);

-- ---------------------------------------------------------------- players
-- Qué hermano es dentro de la familia: 1 paga completo, 2 descuenta una vez,
-- 3 dos veces, y así. Se guarda el orden y no los pesos para que un cambio de
-- tarifa no obligue a tocar jugadores.
ALTER TABLE players ADD COLUMN sibling_rank INTEGER NOT NULL DEFAULT 1
  CHECK (sibling_rank >= 1);

-- Los que tenían el descuento como porcentaje pasan al orden que ese
-- porcentaje significaba. 100 es beca y no se toca.
UPDATE players SET sibling_rank = 2, scholarship = 0 WHERE scholarship = 20;
UPDATE players SET sibling_rank = 3, scholarship = 0 WHERE scholarship = 40;
UPDATE players SET sibling_rank = 4, scholarship = 0 WHERE scholarship = 60;
