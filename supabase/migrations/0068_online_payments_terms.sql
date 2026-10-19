-- Records when an owner accepted the online-payments disclosure (card disputes, fees,
-- who handles refunds) before connecting Stripe.
-- Rollback: supabase/rollbacks/0068_online_payments_terms_rollback.sql
--
-- Run in the Supabase SQL Editor BEFORE the code that uses it ships (and after 0067).
-- POST /api/stripe/connect/start refuses while this is empty. Nothing is backfilled: an
-- existing row stays null until its owner ticks the box in the dialog.

begin;

alter table public.profiles
  add column if not exists online_payments_terms_accepted_at timestamptz;

commit;
