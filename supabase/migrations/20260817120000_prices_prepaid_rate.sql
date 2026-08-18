-- There is no fixed monthly price: paying the month upfront means buying all
-- of that month's trainings at a discounted per-session rate. A 4-training
-- month costs 4 x 25000 = 100k, a 5-training month 125k — which is what the
-- historical monthly payments (50k/75k/100k/125k) actually were. The number
-- of trainings per month comes from training_slots.
ALTER TABLE prices ADD COLUMN prepaid_session_price NUMERIC;
UPDATE prices SET prepaid_session_price = 25000;
ALTER TABLE prices ALTER COLUMN prepaid_session_price SET NOT NULL;
ALTER TABLE prices ADD CONSTRAINT prices_prepaid_positive CHECK (prepaid_session_price > 0);
ALTER TABLE prices DROP COLUMN monthly_price;
