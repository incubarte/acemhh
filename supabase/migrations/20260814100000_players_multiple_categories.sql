-- Players can belong to several categories, ordered by priority: the first
-- element is the main one. The column is renamed (category -> categories) on
-- purpose, so any query still filtering on "category" fails loudly instead of
-- silently excluding multi-category players.

-- u-14 no longer exists as a category; it was replaced by youth.
UPDATE players SET category = 'youth' WHERE category = 'u-14';

ALTER TABLE players RENAME COLUMN category TO categories;

ALTER TABLE players
ALTER COLUMN categories TYPE text[] USING ARRAY[categories];

ALTER TABLE players
ADD CONSTRAINT players_categories_not_empty CHECK (cardinality(categories) >= 1);

ALTER TABLE players
ADD CONSTRAINT players_categories_no_blanks CHECK (NOT ('' = ANY (categories)));
