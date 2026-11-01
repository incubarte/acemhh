-- Desde octubre de 2026 el horario de las 21hs deja de ser el de arqueros:
-- ni a los del club ni a los invitados se les cobra el entrenamiento.
--
-- A un arquero sólo se le cobran las sesiones de un horario con goalies = true
-- (billableAttendances), y ese era el único. Una fila nueva del jueves 21hs
-- desde el 2026-10-01, igual a la vigente salvo por goalies, alcanza: agosto y
-- septiembre se siguen cobrando como entonces, y la deuda que haya quedado de
-- esos meses sigue en pie.
--
-- goalies también hace que el plantel de la sesión liste a todos los
-- arqueros sin buscarlos. Desde octubre, a las 21hs se agregan con "Buscar
-- arquero", como a las 22 o a las 23.
--
-- Nadie pagó como arquero desde octubre (revisado en producción el
-- 2026-11-01). Si apareciera un pago, el ledger dejaría de contarlo sin
-- devolverlo: frenar y decidir a mano.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM payments p
  JOIN players pl ON pl.id = p.player_id
  WHERE pl.player_type = 'goalkeeper'
    AND p.month >= '2026-10'
    AND p.concept IN ('monthly', 'session', 'half month', 'debt settlement');
  IF n > 0 THEN
    RAISE EXCEPTION '% pagos de arqueros desde octubre', n;
  END IF;
END $$;

INSERT INTO training_slot_features (weekday, hour, valid_from, categories, goalies)
SELECT weekday, hour, '2026-10-01', categories, false
FROM training_slot_features
WHERE weekday = 4 AND hour = 21 AND valid_from <= '2026-10-01'
ORDER BY valid_from DESC
LIMIT 1;
