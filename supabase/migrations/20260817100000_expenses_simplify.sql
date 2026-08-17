-- The expense form now uses a fixed concept dropdown ("hora de pista",
-- "seguro", "otros"), which makes payee redundant and month unused. The
-- concept list itself lives in the API (it will evolve); the schema only pins
-- the rule that never changes: "otros" without notes says nothing.
ALTER TABLE expenses DROP COLUMN payee;
ALTER TABLE expenses DROP COLUMN month;

ALTER TABLE expenses ADD CONSTRAINT expenses_otros_needs_notes
CHECK (concept <> 'otros' OR (notes IS NOT NULL AND notes <> ''));
