-- Audit log for the founder /admin page: every manual touch of an account
-- (tier override, Stripe cancel/refund, auth-link generation) plus free-text
-- notes ('note' rows, body stored in `reason`). Read/written only through
-- the service-role client after requireAdmin() - RLS is enabled with no
-- policies, so no signed-in user (including the account it's about) can
-- read or write it through the anon/authenticated roles.
--
-- account_id has no FK on purpose: the log must outlive a deleted account,
-- and account_email is snapshotted for the same reason.
create table if not exists public.admin_actions (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null,
  account_email text not null,
  admin_id      uuid not null,
  action_type   text not null check (action_type in (
    'tier_override',
    'subscription_cancel',
    'subscription_refund',
    'resend_confirmation',
    'password_reset',
    'note'
  )),
  old_value     text,
  new_value     text,
  reason        text not null check (length(btrim(reason)) > 0),
  created_at    timestamptz not null default now()
);

create index if not exists admin_actions_created_at_idx
  on public.admin_actions (created_at desc);
create index if not exists admin_actions_account_idx
  on public.admin_actions (account_id, created_at desc);

alter table public.admin_actions enable row level security;
