-- Per-stylist commission tracking: services, stylists, and the entries
-- logged at the front counter. Entirely separate from job-costing
-- (employees/hour_entries) - stylists are commission-based, not hourly.
--
-- IMPORTANT: same boundary as labor_cost - commission data is never wired
-- into sales/documents/payments or src/lib/hst.ts anywhere. This is for
-- commission payout tracking only, not a tax input.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  default_price numeric(10, 2) not null default 0,
  color text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.services enable row level security;

create index if not exists services_user_id_idx on public.services (user_id);

create policy "Users can view own services"
  on public.services for select
  using (auth.uid() = user_id);

create policy "Users can insert own services"
  on public.services for insert
  with check (auth.uid() = user_id);

create policy "Users can update own services"
  on public.services for update
  using (auth.uid() = user_id);

create policy "Users can delete own services"
  on public.services for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- stylists
-- ---------------------------------------------------------------------------
create table if not exists public.stylists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  pay_type text not null default 'commission'
    check (pay_type in ('commission', 'hourly', 'salary')),
  -- Fraction, not a percentage (0.15 = 15%), so commission_owed below stays
  -- a direct multiply - same convention as hour_entries.rate * hours.
  commission_rate numeric(5, 4) not null default 0
    check (commission_rate >= 0 and commission_rate <= 1),
  created_at timestamptz not null default now()
);

alter table public.stylists enable row level security;

create index if not exists stylists_user_id_idx on public.stylists (user_id);

create policy "Users can view own stylists"
  on public.stylists for select
  using (auth.uid() = user_id);

create policy "Users can insert own stylists"
  on public.stylists for insert
  with check (auth.uid() = user_id);

create policy "Users can update own stylists"
  on public.stylists for update
  using (auth.uid() = user_id);

create policy "Users can delete own stylists"
  on public.stylists for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- commission_entries: one row per logged transaction at the front counter
-- ---------------------------------------------------------------------------
create table if not exists public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  stylist_id uuid not null references public.stylists (id) on delete restrict,
  service_id uuid references public.services (id) on delete set null,
  -- Snapshotted at entry time, same reasoning as document_items - if a
  -- service's name/price is edited later, historical entries must not
  -- change retroactively.
  service_name text not null,
  customer_name text,
  price_charged numeric(10, 2) not null,
  commission_rate_applied numeric(5, 4) not null,
  -- Generated (stored) column, not app-computed, so commission_owed can
  -- never drift from price_charged * commission_rate_applied.
  commission_owed numeric(10, 2)
    generated always as (round(price_charged * commission_rate_applied, 2)) stored,
  -- No separate "work date" field like hour_entries.work_date - entries
  -- are created in real time at the moment of the tap, so created_at is
  -- already the transaction timestamp.
  created_at timestamptz not null default now()
);

alter table public.commission_entries enable row level security;

create index if not exists commission_entries_user_id_idx on public.commission_entries (user_id);
create index if not exists commission_entries_stylist_id_idx on public.commission_entries (stylist_id);
create index if not exists commission_entries_created_at_idx on public.commission_entries (created_at);

create policy "Users can view own commission entries"
  on public.commission_entries for select
  using (auth.uid() = user_id);

create policy "Users can insert own commission entries"
  on public.commission_entries for insert
  with check (auth.uid() = user_id);

create policy "Users can update own commission entries"
  on public.commission_entries for update
  using (auth.uid() = user_id);

create policy "Users can delete own commission entries"
  on public.commission_entries for delete
  using (auth.uid() = user_id);
