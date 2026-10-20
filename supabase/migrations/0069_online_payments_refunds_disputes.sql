-- Online invoice payments, phase 4: refunds, disputes and the double-payment guard.
-- Rollback: supabase/rollbacks/0069_online_payments_refunds_disputes_rollback.sql
--
-- Run in the Supabase SQL Editor BEFORE the code that uses it ships (and after 0067/0068).
-- Nothing existing is rewritten: every column is new and nullable or defaulted, and the
-- one index that changes (below) is replaced by a narrower one that every existing row satisfies.
--
--   payments.source             gains 'stripe_dispute' (a lost dispute). 'stripe_refund' already existed.
--   payments.stripe_refund_id   the Stripe refund a 'stripe_refund' row mirrors. Unique, so a replayed
--                               event can never record the same refund twice.
--   payments.stripe_dispute_id  the Stripe dispute a 'stripe_dispute' row mirrors. Unique.
--   payments_stripe_pi_source_uniq (payment intent, source) is REPLACED. Refund rows carry the payment
--                               intent of the payment they reverse, so several partial refunds of one
--                               payment would collide on it. The new payments_stripe_pi_uniq only
--                               constrains the original 'stripe' payment (one per payment intent, as before).
--   payments_stripe_sign_check  a refund / lost-dispute row is always negative, a 'stripe' payment always
--                               positive. Manual payments are unchanged.
--   documents.payment_disputed  true while a dispute is open on the invoice: drives the banner and the
--                               list badge. Written only by the webhook.
--   stripe_disputes             one row per dispute (status, amount, Stripe's dispute fee - information
--                               only, whether the owner was emailed). Service role only.
--   stripe_overpayments         one row per paid session that over-credited an invoice: what was paid,
--                               what was recorded, the excess and the automatic refund of it. This is
--                               how the excess refund is told apart from a normal refund. Service role only.

begin;

alter table public.payments
  add column if not exists stripe_refund_id text,
  add column if not exists stripe_dispute_id text;

alter table public.payments drop constraint if exists payments_source_check;
alter table public.payments
  add constraint payments_source_check
    check (source in ('manual','stripe','stripe_refund','stripe_dispute'));

alter table public.payments
  add constraint payments_stripe_sign_check
    check (
      source = 'manual'
      or (source = 'stripe' and amount > 0)
      or (source = 'stripe_refund' and amount < 0 and stripe_refund_id is not null)
      or (source = 'stripe_dispute' and amount < 0 and stripe_dispute_id is not null)
    );

drop index if exists public.payments_stripe_pi_source_uniq;

create unique index if not exists payments_stripe_pi_uniq
  on public.payments (stripe_payment_intent_id)
  where source = 'stripe' and stripe_payment_intent_id is not null;

create unique index if not exists payments_stripe_refund_uniq
  on public.payments (stripe_refund_id) where stripe_refund_id is not null;

create unique index if not exists payments_stripe_dispute_uniq
  on public.payments (stripe_dispute_id) where stripe_dispute_id is not null;

alter table public.documents
  add column if not exists payment_disputed boolean not null default false;

create table if not exists public.stripe_disputes (
  id text primary key,                              -- Stripe dispute id (dp_...)
  account_id text not null,
  document_id uuid not null references public.documents (id) on delete cascade,
  payment_intent_id text,
  charge_id text,
  amount numeric(12,2) not null check (amount > 0),
  status text not null,                             -- Stripe's own status, last seen
  fee numeric(12,2),                                -- Stripe's dispute fee: information only
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  owner_notified_at timestamptz
);
alter table public.stripe_disputes enable row level security;  -- no policies: service role only
create index if not exists stripe_disputes_document_idx on public.stripe_disputes (document_id);

create table if not exists public.stripe_overpayments (
  payment_intent_id text primary key,
  account_id text not null,
  document_id uuid not null references public.documents (id) on delete cascade,
  amount_paid numeric(12,2) not null check (amount_paid > 0),
  amount_recorded numeric(12,2) not null check (amount_recorded >= 0),
  amount_excess numeric(12,2) not null check (amount_excess > 0),
  refund_status text not null default 'pending' check (refund_status in ('pending','refunded','failed')),
  refund_id text,
  created_at timestamptz not null default now(),
  owner_notified_at timestamptz,
  failure_notified_at timestamptz
);
alter table public.stripe_overpayments enable row level security;  -- no policies: service role only
create index if not exists stripe_overpayments_document_idx on public.stripe_overpayments (document_id);

commit;
