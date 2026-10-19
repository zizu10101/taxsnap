begin;
alter table public.profiles drop column if exists online_payments_terms_accepted_at;
commit;
