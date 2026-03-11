-- Add 'membership dues' as a valid payments.concept value.
-- Keep existing rules:
-- - monthly => session IS NULL
-- - session => session IS NOT NULL
-- New rule:
-- - membership dues => session IS NULL

alter table public.payments drop constraint if exists payments_concept_valid;
alter table public.payments drop constraint if exists payments_concept_session_rules;

alter table public.payments alter column slot drop not null;

alter table public.payments
  add constraint payments_concept_valid
  check (concept = any (array['monthly'::text, 'session'::text, 'membership dues'::text]));

alter table public.payments
  add constraint payments_concept_session_rules
  check (
    (concept = 'monthly'::text and session is null)
    or (concept = 'session'::text and session is not null)
    or (concept = 'membership dues'::text and session is null)
  );
