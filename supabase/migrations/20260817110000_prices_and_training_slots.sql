-- Prices and the training agenda move into the database.
--
-- prices: one row per tariff change (valid_from). The price for a date is the
-- newest row at or before it.
--
-- training_slots: one row per real training slot (date + hour). Holidays
-- simply have no row — delete the row and every consumer (dashboard roster,
-- WhatsApp status agenda) follows. Replaces the hardcoded schedule maps in
-- dashboard/src/lib/schedule.ts and ACTIVE_MONTHS in the whatsapp webhook.

CREATE TABLE prices (
  valid_from DATE PRIMARY KEY,
  session_price NUMERIC NOT NULL CHECK (session_price > 0),
  monthly_price NUMERIC NOT NULL CHECK (monthly_price > 0)
);

-- Current tariff. Historic tiers varied (50k/75k/100k monthly rows exist);
-- monthly_price is the full standard month — adjust with an UPDATE, and
-- register future changes by INSERTing a new valid_from row.
INSERT INTO prices (valid_from, session_price, monthly_price)
VALUES ('2026-01-01', 30000, 100000);

CREATE TABLE training_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL,
  hour INT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  categories TEXT[] NOT NULL CHECK (cardinality(categories) >= 1),
  -- Goalkeeper-friendly slot: every goalie trains here regardless of category.
  goalies BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (date, hour)
);

CREATE INDEX idx_training_slots_date ON training_slots(date);

-- Past slots, derived from what actually happened (attendance and per-session
-- payments), with the categories of the schedule era they belong to:
-- before 2026-05-01: 21 cat-a / 22 cat-b / 23 cat-c; after: 21 youth /
-- 22 cat-a+cat-b / 23 cat-c. 21hs was always the goalie-friendly slot.
WITH sess AS (
  SELECT session FROM attendances
  UNION
  SELECT session FROM payments WHERE session IS NOT NULL
), parsed AS (
  SELECT DISTINCT
    substring(session FROM 1 FOR 10)::date AS d,
    substring(session FROM 12 FOR 2)::int AS h
  FROM sess
)
INSERT INTO training_slots (date, hour, categories, goalies)
SELECT
  d,
  h,
  CASE
    WHEN h = 21 AND d <  '2026-05-01' THEN ARRAY['cat-a']
    WHEN h = 21                       THEN ARRAY['youth']
    WHEN h = 22 AND d <  '2026-05-01' THEN ARRAY['cat-b']
    WHEN h = 22                       THEN ARRAY['cat-a', 'cat-b']
    ELSE ARRAY['cat-c']
  END,
  h = 21
FROM parsed
ON CONFLICT (date, hour) DO NOTHING;

-- Future slots: every remaining Thursday of the 2026 second semester with the
-- current schedule. Holidays are handled by deleting their rows.
INSERT INTO training_slots (date, hour, categories, goalies)
SELECT d::date, v.hour, v.categories, v.hour = 21
FROM generate_series('2026-08-20'::date, '2026-12-31'::date, INTERVAL '7 days') AS d
CROSS JOIN (VALUES
  (21, ARRAY['youth']),
  (22, ARRAY['cat-a', 'cat-b']),
  (23, ARRAY['cat-c'])
) AS v(hour, categories)
ON CONFLICT (date, hour) DO NOTHING;

-- Read by the dashboard (service role) and the whatsapp webhook.
ALTER TABLE prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE prices, training_slots FROM anon, authenticated;
GRANT ALL ON TABLE prices, training_slots TO service_role;
