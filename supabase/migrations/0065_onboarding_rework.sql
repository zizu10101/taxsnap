-- Onboarding rework: province/currency, the goal picker, activation timestamps,
-- the checklist dismissal and clearly-labelled sample data.
-- Rollback: supabase/rollbacks/0065_onboarding_rework_rollback.sql
--
-- Run in the Supabase SQL Editor BEFORE the code that uses these columns ships.
--
--   profiles.province                 two-letter code. Existing accounts default to 'ON' (the only
--                                     province whose tax the app calculates today).
--   profiles.currency                 'CAD' only for now (nothing else is formatted or calculated).
--   profiles.onboarding_goal          'invoices' | 'expenses' | 'job_profit' | 'salon'; null = not asked.
--   profiles.first_invoice_sent_at    set once, the first time an invoice is emailed / link copied /
--                                     downloaded / shared. Never overwritten.
--   profiles.first_receipt_saved_at   set once, the first time a receipt is saved. Never overwritten.
--   profiles.checklist_dismissed_at   the dashboard checklist was closed by the owner.
--   clients.is_sample / jobs.is_sample  the one demo client and job "Try with sample data" creates.
--                                     Excluded from plan caps and reports, and refused as the client
--                                     or job of any invoice, estimate, receipt or hour entry, so a
--                                     sample row can never reach a PDF, public page, portal, email,
--                                     export or the HST totals. Nothing is backfilled (all false).
-- Nothing existing is rewritten: every column is new and nullable or defaulted.

begin;

alter table public.profiles
  add column if not exists province text not null default 'ON',
  add column if not exists currency text not null default 'CAD',
  add column if not exists onboarding_goal text,
  add column if not exists first_invoice_sent_at timestamptz,
  add column if not exists first_receipt_saved_at timestamptz,
  add column if not exists checklist_dismissed_at timestamptz;

alter table public.profiles
  add constraint profiles_province_check
    check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  add constraint profiles_currency_check check (currency in ('CAD')),
  add constraint profiles_onboarding_goal_check
    check (onboarding_goal is null or onboarding_goal in ('invoices','expenses','job_profit','salon'));

alter table public.clients add column if not exists is_sample boolean not null default false;
alter table public.jobs add column if not exists is_sample boolean not null default false;

-- At most one sample client and one sample job per owner.
create unique index if not exists clients_one_sample_per_user on public.clients (user_id) where is_sample;
create unique index if not exists jobs_one_sample_per_user on public.jobs (user_id) where is_sample;

commit;
