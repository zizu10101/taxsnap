-- Chair Rental: simple, private record-keeping for salon accounts that
-- rent out a chair/station to an independent renter who runs their own
-- separate business (not an employee, not a commission stylist).
--
-- IMPORTANT: same tax boundary as labor_cost/commission_owed - this data
-- is NEVER wired into sales/documents/payments or src/lib/hst.ts, and is
-- deliberately not referenced by commission-overview-query.ts either.
-- Neither table below has any FK to stylists/services/commission_entries/
-- register_transactions - a renter is a standalone entity, structurally
-- unconnected to the salon's Commission/Register feature, not just by
-- convention.
--
-- No edit-trail/snapshot columns like commission_entries has (see that
-- table's original_*/edited_at) - this is intentionally simple, private
-- record-keeping with no downstream consequence (no payout batching, no
-- commission math), so a plain editable log row is enough.

create table if not exists public.renters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  rental_rate numeric(10, 2) not null default 0,
  -- Informational label only - nothing in the app computes a due date or
  -- prorates from this, it's just displayed next to the rate.
  rate_cadence text not null default 'monthly'
    check (rate_cadence in ('weekly', 'monthly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.renters enable row level security;

create index if not exists renters_user_id_idx on public.renters (user_id);

create policy "Users can view own renters"
  on public.renters for select
  using (auth.uid() = user_id);

create policy "Users can insert own renters"
  on public.renters for insert
  with check (auth.uid() = user_id);

create policy "Users can update own renters"
  on public.renters for update
  using (auth.uid() = user_id);

create policy "Users can delete own renters"
  on public.renters for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- rent_payments: one row per "mark as paid" log entry. on delete restrict
-- on renter_id, same as hour_entries.employee_id - a renter is deactivated,
-- never deleted, so historical log rows always keep a real renter to
-- point at.
-- ---------------------------------------------------------------------------
create table if not exists public.rent_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  renter_id uuid not null references public.renters (id) on delete restrict,
  paid_date date not null default current_date,
  -- Defaults to the renter's rental_rate client-side at log time, but
  -- freely editable (a partial payment, a one-off adjustment, etc.) - not
  -- a generated/derived column.
  amount numeric(10, 2) not null,
  created_at timestamptz not null default now()
);

alter table public.rent_payments enable row level security;

create index if not exists rent_payments_user_id_idx on public.rent_payments (user_id);
create index if not exists rent_payments_renter_id_idx on public.rent_payments (renter_id);
create index if not exists rent_payments_paid_date_idx on public.rent_payments (paid_date);

create policy "Users can view own rent payments"
  on public.rent_payments for select
  using (auth.uid() = user_id);

create policy "Users can insert own rent payments"
  on public.rent_payments for insert
  with check (auth.uid() = user_id);

create policy "Users can update own rent payments"
  on public.rent_payments for update
  using (auth.uid() = user_id);

create policy "Users can delete own rent payments"
  on public.rent_payments for delete
  using (auth.uid() = user_id);
