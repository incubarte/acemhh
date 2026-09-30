-- The 15th and the 29th of October 2026 have no training. Their sessions come
-- off the agenda: the ledger counts a slot's sessions in the month to price
-- it, so October's month costs three sessions, not five.
--
-- Only safe while nothing hangs from those days. An attendance or a payment
-- there means somebody already acted on them: stop, and let a human decide.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM attendances
  WHERE session LIKE '2026-10-15 %' OR session LIKE '2026-10-29 %';
  IF n > 0 THEN
    RAISE EXCEPTION '% asistencias el 15 o el 29 de octubre', n;
  END IF;

  SELECT count(*) INTO n FROM payments
  WHERE session LIKE '2026-10-15 %' OR session LIKE '2026-10-29 %';
  IF n > 0 THEN
    RAISE EXCEPTION '% pagos por sesiones del 15 o el 29 de octubre', n;
  END IF;

  -- A month already bought was priced with the five sessions.
  SELECT count(*) INTO n FROM payments
  WHERE month = '2026-10' AND concept IN ('monthly', 'half month');
  IF n > 0 THEN
    RAISE EXCEPTION '% pagos del mes de octubre ya registrados con el precio de cinco sesiones', n;
  END IF;
END $$;

DELETE FROM training_sessions WHERE date IN ('2026-10-15', '2026-10-29');
