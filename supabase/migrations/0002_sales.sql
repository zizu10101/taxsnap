-- Gross sales tracking for the Ontario HST Return Helper.
-- One row per user per reporting period (period_label matches the label
-- shown by the dashboard's date-range filter, e.g. "Q3 2026" or a custom
-- range string), holding manually-entered figures the receipts table can't
-- derive on its own (total revenue, and bank deposits kept for the user's
-- own reconciliation - see src/lib/hst.ts for why deposits aren't summed
-- into revenue).

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  period_label text not null,
  gross_sales numeric(12, 2) not null default 0,
  cash_deposits numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, period_label)
);

alter table public.sales enable row level security;

create index if not exists sales_user_id_idx on public.sales (user_id);

create policy "Users can view own sales"
  on public.sales for select
  using (auth.uid() = user_id);

create policy "Users can insert own sales"
  on public.sales for insert
  with check (auth.uid() = user_id);

create policy "Users can update own sales"
  on public.sales for update
  using (auth.uid() = user_id);

create policy "Users can delete own sales"
  on public.sales for delete
  using (auth.uid() = user_id);
