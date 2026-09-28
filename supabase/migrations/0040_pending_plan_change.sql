alter table public.profiles
  add column if not exists pending_tier text
    check (pending_tier in ('basic', 'pro')),
  add column if not exists pending_billing_interval text
    check (pending_billing_interval in ('monthly', 'yearly')),
  add column if not exists pending_change_effective_at timestamptz;
