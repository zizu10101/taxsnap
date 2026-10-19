-- Onboarding goals become a list, and the business gets an optional HST/BN number.
-- Rollback: supabase/rollbacks/0066_onboarding_goals_business_number_rollback.sql
--
-- Run in the Supabase SQL Editor BEFORE the code that uses these columns ships
-- (and after 0065).
--
--   profiles.onboarding_goals   text[] of 'invoices' | 'expenses' | 'job_profit' | 'salon', in the
--                               order the owner picked them. Backfilled from the single
--                               onboarding_goal. The old onboarding_goal column is KEPT (the app
--                               keeps writing the first goal into it), so a rollback loses nothing.
--   profiles.business_number    the business's HST/GST registration (BN) number, free text, optional.
--                               Printed in the "From" block of invoices and estimates.

begin;

alter table public.profiles
  add column if not exists onboarding_goals text[] not null default '{}',
  add column if not exists business_number text;

alter table public.profiles
  add constraint profiles_onboarding_goals_check
    check (onboarding_goals <@ array['invoices','expenses','job_profit','salon']::text[]),
  add constraint profiles_business_number_check
    check (business_number is null or char_length(business_number) between 1 and 40);

update public.profiles
   set onboarding_goals = array[onboarding_goal]
 where onboarding_goal is not null
   and onboarding_goals = '{}';

commit;
