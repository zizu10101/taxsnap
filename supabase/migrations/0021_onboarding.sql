-- Tracks whether a salon-business_type account has been through (or
-- skipped through) the salon onboarding flow (/onboarding) at least once.
-- Same backfill-then-new-default pattern as 0020_business_type.sql: existing
-- accounts get explicitly backfilled to true so they never see a flow that
-- didn't exist when they signed up, and the column default only applies to
-- new signups going forward.
--
-- Irrelevant for a 'general' business_type account - the redirect that
-- checks this (dashboard/page.tsx) also checks business_type = 'salon'
-- first, so this column never actually gates anything for a general
-- account regardless of its value.
alter table public.profiles
  add column if not exists onboarding_completed boolean not null default false;

update public.profiles
set onboarding_completed = true;
