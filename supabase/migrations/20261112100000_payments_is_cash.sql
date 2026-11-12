-- Whether a payment was cash comes back, as a fact of each payment.
--
-- It left in 20260930100000 because it could only repeat the concept:
-- membership dues go to the bank, the rest is collected in hand. Then a player
-- started paying her training by transfer. The concept still gives the usual
-- answer, and the column is where a single payment says otherwise.
--
-- When the column was dropped, every row agreed with its concept (that
-- migration checked), so filling it from the concept restores it exactly.

ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_cash BOOLEAN;
UPDATE payments SET is_cash = (concept <> 'membership dues') WHERE is_cash IS NULL;

-- An insert that does not say takes the concept's answer, so every writer
-- that predates the column keeps working unchanged.
CREATE OR REPLACE FUNCTION payments_default_is_cash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_cash IS NULL THEN
    NEW.is_cash := NEW.concept <> 'membership dues';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_default_is_cash ON payments;
CREATE TRIGGER payments_default_is_cash
  BEFORE INSERT ON payments
  FOR EACH ROW
  EXECUTE FUNCTION payments_default_is_cash();

ALTER TABLE payments ALTER COLUMN is_cash SET NOT NULL;

-- Dues are never cash: the bank account is the only way they are paid.
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_dues_not_cash;
ALTER TABLE payments ADD CONSTRAINT payments_dues_not_cash
  CHECK (concept <> 'membership dues' OR is_cash = false);

COMMENT ON COLUMN payments.is_cash IS
  'True when collected in hand: it adds to the caja of whoever registered it. False when it went to the bank account (dues always; anything else paid by transfer).';
