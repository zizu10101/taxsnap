-- Business profile fields shown on every invoice/estimate, collected via a
-- one-time onboarding prompt (skippable, editable later) on first visit to
-- the invoices/estimates area.
alter table public.profiles add column if not exists business_name text;
alter table public.profiles add column if not exists business_address text;
alter table public.profiles add column if not exists business_phone text;
alter table public.profiles add column if not exists business_email text;
alter table public.profiles add column if not exists business_profile_skipped boolean not null default false;
