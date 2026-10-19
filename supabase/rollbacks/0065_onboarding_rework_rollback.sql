begin;
drop index if exists public.clients_one_sample_per_user;
drop index if exists public.jobs_one_sample_per_user;
alter table public.clients drop column if exists is_sample;
alter table public.jobs drop column if exists is_sample;
alter table public.profiles
  drop constraint if exists profiles_province_check,
  drop constraint if exists profiles_currency_check,
  drop constraint if exists profiles_onboarding_goal_check,
  drop column if exists province,
  drop column if exists currency,
  drop column if exists onboarding_goal,
  drop column if exists first_invoice_sent_at,
  drop column if exists first_receipt_saved_at,
  drop column if exists checklist_dismissed_at;
commit;
