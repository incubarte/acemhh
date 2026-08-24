-- Sessions and slot features get separated.
--
-- A SLOT is a weekday plus an hour ("jue 22hs") — stable over time, and
-- already half-present in the data as payments.slot. A SESSION is one concrete
-- training: a date plus an hour. The table named training_slots was holding
-- sessions all along, so it gets its real name.
--
-- Categories and goalies are features of the SLOT, not of each session, and
-- they change over time (a category joins, the goalie hour moves). They move
-- into their own table, versioned by valid_from exactly like prices: the row
-- in force for a session is the newest one at or before its date.
--
-- Why versioned and not just current: a session's features must resolve AS OF
-- its own date. Today every session row carries its features frozen, so the
-- history is reproducible by accident. Resolving against "the config of today"
-- instead would make adding a category to a slot retroactively change how many
-- trainings a closed month had — and with it, debts already collected.

ALTER TABLE training_slots RENAME TO training_sessions;

ALTER INDEX training_slots_pkey RENAME TO training_sessions_pkey;
ALTER INDEX training_slots_date_hour_key RENAME TO training_sessions_date_hour_key;
ALTER INDEX idx_training_slots_date RENAME TO idx_training_sessions_date;
ALTER TABLE training_sessions RENAME CONSTRAINT training_slots_hour_check
  TO training_sessions_hour_check;

-- weekday is ISO: 1 = Monday .. 7 = Sunday, matching extract(isodow).
CREATE TABLE training_slot_features (
  weekday INT NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  hour INT NOT NULL CHECK (hour BETWEEN 0 AND 23),
  valid_from DATE NOT NULL,
  categories TEXT[] NOT NULL CHECK (cardinality(categories) >= 1),
  -- Goalkeeper-friendly slot: every goalie trains here regardless of category.
  goalies BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (weekday, hour, valid_from)
);

-- Backfill: every slot has held exactly one configuration so far, so one row
-- each, in force from its first session.
INSERT INTO training_slot_features (weekday, hour, valid_from, categories, goalies)
SELECT
  EXTRACT(isodow FROM date)::INT,
  hour,
  MIN(date),
  categories,
  goalies
FROM training_sessions
GROUP BY 1, 2, categories, goalies;

ALTER TABLE training_sessions DROP COLUMN categories;
ALTER TABLE training_sessions DROP COLUMN goalies;

-- Resolution in one place, so no consumer reimplements "newest valid_from at
-- or before this date". LEFT JOIN on purpose: a session whose slot has no
-- features yields NULL rather than vanishing from the result. Callers must
-- treat that NULL as an error — guessing a slot's categories means charging
-- the wrong people, which is worse than a broken screen.
CREATE VIEW training_sessions_resolved
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.date,
  s.hour,
  f.categories,
  f.goalies
FROM training_sessions s
LEFT JOIN LATERAL (
  SELECT categories, goalies
  FROM training_slot_features f
  WHERE f.weekday = EXTRACT(isodow FROM s.date)::INT
    AND f.hour = s.hour
    AND f.valid_from <= s.date
  ORDER BY f.valid_from DESC
  LIMIT 1
) f ON TRUE;

ALTER TABLE training_slot_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE training_slot_features FROM anon, authenticated;
GRANT ALL ON TABLE training_slot_features TO service_role;
REVOKE ALL ON training_sessions_resolved FROM anon, authenticated;
GRANT SELECT ON training_sessions_resolved TO service_role;
