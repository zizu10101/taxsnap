-- Online invoice payments with Stripe Connect (phases 1-3).
-- Rollback: supabase/rollbacks/0067_online_payments_connect_rollback.sql
--
-- Run in the Supabase SQL Editor BEFORE the code that uses these columns ships.
--
--   profiles.stripe_connect_*        the contractor's own connected account (full-dashboard, direct
--                                    charges). status is kept in step by account.updated and by the
--                                    return URL; charges_enabled is the only thing that shows "Pay now".
--   documents.requested_payment_amount  reserved for the later deposit feature (nothing writes it yet).
--   documents.online_session_opened_at  set the first time a Checkout Session is opened for the invoice;
--                                    after that the invoice can not be set back to draft.
--   payments.source / stripe_*       how a payment arrived. 'manual' for everything that exists today.
--                                    A 'stripe' row can not be edited or deleted in the app. stripe_fee and
--                                    stripe_net are information only - they never change `amount`, so the
--                                    HST sales figures are exactly what a manual payment would give.
--   stripe_events                    every webhook event id seen (idempotency). Service role only.
--   checkout_attempts                one row per "Pay now" click, for rate limiting. Service role only.
-- Nothing existing is rewritten: every column is new and nullable or defaulted.

begin;

alter table public.profiles
  add column if not exists stripe_connect_account_id text,
  add column if not exists stripe_connect_status text not null default 'not_connected',
  add column if not exists stripe_connect_charges_enabled boolean not null default false,
  add column if not exists stripe_connect_payouts_enabled boolean not null default false,
  add column if not exists stripe_connect_checked_at timestamptz;

alter table public.profiles
  add constraint profiles_stripe_connect_status_check
    check (stripe_connect_status in ('not_connected','incomplete','restricted','active','disconnected'));

create unique index if not exists profiles_stripe_connect_account_uniq
  on public.profiles (stripe_connect_account_id) where stripe_connect_account_id is not null;

alter table public.documents
  add column if not exists requested_payment_amount numeric(12,2),
  add column if not exists online_session_opened_at timestamptz;

alter table public.documents
  add constraint documents_requested_payment_amount_check
    check (requested_payment_amount is null or requested_payment_amount > 0);

alter table public.payments
  add column if not exists source text not null default 'manual',
  add column if not exists stripe_account_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists stripe_fee numeric(12,2),
  add column if not exists stripe_net numeric(12,2);

alter table public.payments
  add constraint payments_source_check check (source in ('manual','stripe','stripe_refund'));

-- One payment per Stripe payment intent per source: a replayed webhook can not record it twice.
create unique index if not exists payments_stripe_pi_source_uniq
  on public.payments (stripe_payment_intent_id, source) where stripe_payment_intent_id is not null;

create table if not exists public.stripe_events (
  id text primary key,
  account_id text,
  type text not null,
  note text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
alter table public.stripe_events enable row level security;  -- no policies: service role only

create table if not exists public.checkout_attempts (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.checkout_attempts enable row level security;  -- no policies: service role only
create index if not exists checkout_attempts_token_idx on public.checkout_attempts (token_hash, created_at);
create index if not exists checkout_attempts_ip_idx on public.checkout_attempts (ip_hash, created_at);

commit;
