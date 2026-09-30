-- ---------------------------------------------------------------- is_cash
-- Whether a payment is cash was always its concept in disguise: membership dues
-- go to the bank, everything else is collected in hand and enters the caja of
-- whoever registered it. The flag could only ever disagree with the concept,
-- so it goes, and the caja reads the concept.
--
-- If any row disagrees, dropping the column would silently move money between
-- cajas: stop instead, and let a human look at it.
DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM payments
  WHERE is_cash <> (concept <> 'membership dues');
  IF bad > 0 THEN
    RAISE EXCEPTION '% pagos tienen is_cash distinto de lo que dice su concepto', bad;
  END IF;
END $$;

ALTER TABLE payments DROP CONSTRAINT payments_dues_not_cash;
ALTER TABLE payments DROP COLUMN is_cash;

-- ---------------------------------------------------------------- notes
-- Whatever the collector wants to remember at the arqueo: "me lo transfirieron
-- a mi cuenta" is money in their caja that is not in their pocket.
ALTER TABLE payments ADD COLUMN notes TEXT CHECK (notes IS NULL OR notes <> '');

-- ---------------------------------------------------------------- incomes
-- Money that comes in without a player behind it — a colecta, a feria del
-- plato. It has no month, slot or team, so it does not belong in payments;
-- it is the mirror image of an expense. Always cash, into the caja of whoever
-- received it.
CREATE TABLE incomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  concept TEXT NOT NULL CHECK (concept <> ''),
  received_by uuid NOT NULL REFERENCES users(id),
  notes TEXT CHECK (notes IS NULL OR notes <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER update_incomes_updated_at
BEFORE UPDATE ON incomes
FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

-- Written only via the service role, like expenses and handoffs.
ALTER TABLE incomes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE incomes FROM anon, authenticated;
GRANT ALL ON TABLE incomes TO service_role;

-- ---------------------------------------------------------------- Rookies
-- Las cuotas de la D del Clausura 2026 pasan a 40/40/50/20 (antes 50/50/45/20),
-- y el anticipado a 140.000 para que siga saliendo menos que las cuotas.
UPDATE tournament_installments SET amount = v.amount
FROM (VALUES
  ('2026-09', 40000), ('2026-10', 40000), ('2026-11', 50000), ('2026-12', 20000)
) AS v(month, amount)
WHERE category_id = '6b1f2c3a-0002-4c26-9a11-000000000004'
  AND tournament_installments.month = v.month;

UPDATE tournament_categories SET upfront_price = 140000
WHERE id = '6b1f2c3a-0002-4c26-9a11-000000000004';

DO $$
DECLARE total NUMERIC;
BEGIN
  SELECT sum(amount) INTO total FROM tournament_installments
  WHERE category_id = '6b1f2c3a-0002-4c26-9a11-000000000004';
  IF total <> 150000 THEN
    RAISE EXCEPTION 'Las cuotas de Rookies suman %, no 150000', total;
  END IF;
END $$;
