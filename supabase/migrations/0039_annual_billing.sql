alter table public.profiles
  add column if not exists stripe_subscription_id text,
  add column if not exists billing_interval text
    check (billing_interval in ('monthly', 'yearly')),
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false;
