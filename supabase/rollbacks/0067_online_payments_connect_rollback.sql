begin;
drop table if exists public.checkout_attempts;
drop table if exists public.stripe_events;
drop index if exists public.payments_stripe_pi_source_uniq;
alter table public.payments
  drop constraint if exists payments_source_check,
  drop column if exists source,
  drop column if exists stripe_account_id,
  drop column if exists stripe_checkout_session_id,
  drop column if exists stripe_payment_intent_id,
  drop column if exists stripe_charge_id,
  drop column if exists stripe_fee,
  drop column if exists stripe_net;
alter table public.documents
  drop constraint if exists documents_requested_payment_amount_check,
  drop column if exists requested_payment_amount,
  drop column if exists online_session_opened_at;
drop index if exists public.profiles_stripe_connect_account_uniq;
alter table public.profiles
  drop constraint if exists profiles_stripe_connect_status_check,
  drop column if exists stripe_connect_account_id,
  drop column if exists stripe_connect_status,
  drop column if exists stripe_connect_charges_enabled,
  drop column if exists stripe_connect_payouts_enabled,
  drop column if exists stripe_connect_checked_at;
commit;
