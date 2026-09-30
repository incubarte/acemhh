-- Thursday 24 September 2026 had no training. Its sessions come off the
-- agenda, so September held three sessions per slot, not four.
--
-- The month was already sold at four: whoever paid it in full paid for a
-- session the club did not give. That is exactly the promotional carryover the
-- ledger already knows (supabase/functions/_shared/tokens.ts): the surplus
-- comes back as a session to use in October. And a partial month is measured
-- against the three sessions it really held.
--
-- Nobody can have trained that day: an attendance or a session payment on it
-- means the premise is wrong. Stop, and let a human look.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM attendances
  WHERE session LIKE '2026-09-24 %' AND attended;
  IF n > 0 THEN
    RAISE EXCEPTION '% asistencias el 24 de septiembre', n;
  END IF;

  SELECT count(*) INTO n FROM payments WHERE session LIKE '2026-09-24 %';
  IF n > 0 THEN
    RAISE EXCEPTION '% pagos por sesiones del 24 de septiembre', n;
  END IF;
END $$;

DELETE FROM training_sessions WHERE date = '2026-09-24';
