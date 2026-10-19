-- Drops the list column and the BN number. The original onboarding_goal column was never removed,
-- so the single goal is still there.
begin;
alter table public.profiles
  drop constraint if exists profiles_onboarding_goals_check,
  drop constraint if exists profiles_business_number_check,
  drop column if exists onboarding_goals,
  drop column if exists business_number;
commit;
