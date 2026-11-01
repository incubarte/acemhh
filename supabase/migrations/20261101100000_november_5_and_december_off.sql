-- Thursday 5 November 2026 has no training, and December has none at all.
-- Their sessions come off the agenda: November costs three sessions per slot,
-- not four, and December has nothing to charge.
--
-- Only safe while nothing hangs from those days. An attendance or a payment
-- there means somebody already acted on them: stop, and let a human decide.
-- An attendance marked and then unmarked is just a row that says nobody came.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM attendances
  WHERE (session LIKE '2026-11-05 %' OR session LIKE '2026-12-%') AND attended;
  IF n > 0 THEN
    RAISE EXCEPTION '% asistencias el 5 de noviembre o en diciembre', n;
  END IF;

  SELECT count(*) INTO n FROM payments
  WHERE session LIKE '2026-11-05 %' OR session LIKE '2026-12-%';
  IF n > 0 THEN
    RAISE EXCEPTION '% pagos por sesiones del 5 de noviembre o de diciembre', n;
  END IF;

  -- A month already bought was priced with the sessions it no longer has.
  -- The one exception is Didier's 10.000 advance on November at 23hs: under
  -- any three-session month, so it just leaves him less to pay. Any other
  -- payment showing up still stops this.
  SELECT count(*) INTO n FROM payments
  WHERE month IN ('2026-11', '2026-12') AND concept IN ('monthly', 'half month')
    AND id <> '2e78779b-7fc6-4259-a4a7-a4a1ff9e14d4';
  IF n > 0 THEN
    RAISE EXCEPTION '% pagos del mes de noviembre o diciembre ya registrados con el precio viejo', n;
  END IF;
END $$;

DELETE FROM training_sessions
WHERE date = '2026-11-05'
   OR date BETWEEN '2026-12-01' AND '2026-12-31';
