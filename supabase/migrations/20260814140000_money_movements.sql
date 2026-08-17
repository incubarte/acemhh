-- Money movements beyond player charges: club expenses (e.g. rink rental) and
-- cash handoffs between admins. Together with cash payments they make each
-- admin's cash balance ("caja") derivable:
--
--   caja(admin) = cash payments they registered
--               - cash expenses they paid
--               - handoffs given + handoffs received (accepted only)

-- Membership dues are paid straight to the bank account, never in cash, so
-- they must not count toward the registering admin's caja.
UPDATE payments SET is_cash = false WHERE concept = 'membership dues';
ALTER TABLE payments ADD CONSTRAINT payments_dues_not_cash
CHECK (concept <> 'membership dues' OR is_cash = false);

-- registered_by is a display string; balances need a real key. Filled by the
-- dashboard on new inserts; old rows are backfilled by hand and stay out of
-- balances until then. The deprecated telegram bot leaves it NULL.
ALTER TABLE payments ADD COLUMN registered_by_user_id uuid REFERENCES users(id);

CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  concept TEXT NOT NULL CHECK (concept <> ''),
  payee TEXT NOT NULL CHECK (payee <> ''),
  -- For recurring expenses like the rink rental.
  month TEXT CHECK (month IS NULL OR month ~ '^\d{4}-\d{2}$'),
  paid_by uuid NOT NULL REFERENCES users(id),
  -- Cash expenses come out of paid_by's caja; bank payments touch no caja.
  is_cash BOOLEAN NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE OR REPLACE TRIGGER update_expenses_updated_at
BEFORE UPDATE ON expenses
FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime('updated_at');

CREATE TABLE cash_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  from_user uuid NOT NULL REFERENCES users(id),
  to_user uuid NOT NULL REFERENCES users(id),
  CHECK (from_user <> to_user),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The giver registers the handoff; it only moves balances once the receiver
  -- confirms. Cash between people is exactly where disputes appear later.
  accepted_at TIMESTAMPTZ
);

-- Written only via the service role, like the whatsapp tables.
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_handoffs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE expenses, cash_handoffs FROM anon, authenticated;
GRANT ALL ON TABLE expenses, cash_handoffs TO service_role;
