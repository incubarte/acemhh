-- Schema for the token model (docs/modelo-de-cobros.md).
--
-- Three independent changes that the new ledger needs before it can be
-- written: what a goalkeeper's session costs, what a payment is FOR, and which
-- attendances the club decided not to charge.

-- ---------------------------------------------------------------- prices
-- Goalkeepers pay 25k a session, and their month is just that price times the
-- sessions of their slot — the promotional rate and the individual rate are
-- the same number for them, so one column serves both. Kept separate from the
-- players' prepaid rate on purpose: lowering that one must not silently move
-- what goalkeepers pay.
ALTER TABLE prices ADD COLUMN goalkeeper_session_price NUMERIC;
UPDATE prices SET goalkeeper_session_price = 25000;
ALTER TABLE prices ALTER COLUMN goalkeeper_session_price SET NOT NULL;
ALTER TABLE prices ADD CONSTRAINT prices_goalkeeper_positive
  CHECK (goalkeeper_session_price > 0);

-- ---------------------------------------------------------------- payments
-- The slot a payment is for stops being a locale-formatted string ("jue 22hs",
-- built with toLocaleString) and becomes the pair that actually identifies a
-- slot, which is also the key of training_slot_features. The promotional
-- carryover cap needs it: it compares the sessions a monthly payment bought
-- against the sessions that slot really held.
ALTER TABLE payments ADD COLUMN slot_weekday INT CHECK (slot_weekday BETWEEN 1 AND 7);
ALTER TABLE payments ADD COLUMN slot_hour INT CHECK (slot_hour BETWEEN 0 AND 23);

UPDATE payments SET
  slot_weekday = CASE lower(split_part(slot, ' ', 1))
    WHEN 'lun' THEN 1 WHEN 'mar' THEN 2 WHEN 'mié' THEN 3 WHEN 'mie' THEN 3
    WHEN 'jue' THEN 4 WHEN 'vie' THEN 5 WHEN 'sáb' THEN 6 WHEN 'sab' THEN 6
    WHEN 'dom' THEN 7 END,
  slot_hour = NULLIF(regexp_replace(split_part(slot, ' ', 2), '\D', '', 'g'), '')::INT
WHERE slot IS NOT NULL;

-- Every training payment must have parsed; anything left half-parsed is a slot
-- string we did not understand, and silently dropping it would lose the money.
DO $$
DECLARE bad INT;
BEGIN
  SELECT count(*) INTO bad FROM payments
  WHERE slot IS NOT NULL AND (slot_weekday IS NULL OR slot_hour IS NULL);
  IF bad > 0 THEN
    RAISE EXCEPTION 'No pude interpretar el slot de % pagos', bad;
  END IF;
END $$;

ALTER TABLE payments DROP COLUMN slot;

-- Paying down debt is its own concept: it settles closed months and buys no
-- sessions, so it can never be read as a purchase.
ALTER TABLE payments DROP CONSTRAINT payments_concept_valid;
ALTER TABLE payments ADD CONSTRAINT payments_concept_valid
  CHECK (concept IN ('monthly', 'session', 'membership dues', 'debt settlement'));

-- Only a session payment names a session. A debt settlement is recorded
-- against the slot where the cash was taken (the caja cares) but not against
-- any one training.
ALTER TABLE payments DROP CONSTRAINT payments_concept_session_rules;
ALTER TABLE payments ADD CONSTRAINT payments_concept_session_rules
  CHECK (
    (concept = 'session' AND session IS NOT NULL)
    OR (concept <> 'session' AND session IS NULL)
  );

-- Dues go to the bank and belong to no slot; everything else is collected at
-- one, which is how the caja attributes the cash.
ALTER TABLE payments ADD CONSTRAINT payments_slot_by_concept
  CHECK (
    (concept = 'membership dues' AND slot_weekday IS NULL AND slot_hour IS NULL)
    OR (concept <> 'membership dues' AND slot_weekday IS NOT NULL AND slot_hour IS NOT NULL)
  );

-- ---------------------------------------------------------------- attendances
-- An attendance the club decided not to charge. This one is DATA, not a rule:
-- it is the admin's call — the player who makes up a missed training in
-- another slot, or any one-off arrangement — and cannot be derived from
-- anything.
--
-- The youth bonus (a second session the same day) is deliberately NOT stored
-- here: that one IS a rule, and a stored copy goes stale the moment the 21hs
-- attendance is marked after the 22hs one, or unmarked afterwards.
ALTER TABLE attendances ADD COLUMN bonified BOOLEAN NOT NULL DEFAULT false;
