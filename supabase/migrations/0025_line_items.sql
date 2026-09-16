-- Reusable saved line items for general-business invoicing (invoices &
-- estimates). Deliberately a separate table from `services` - services is
-- the salon Commission catalog (required `color` for CommissionLogger's
-- card grid, active-capped, snapshotted into commission_entries).
-- line_items has no downstream foreign key from document_items (which
-- already snapshots its own description/unit_price at add time, same as
-- every other snapshot-on-insert table in this schema), so a saved item
-- is a pure reusable template with no historical record to preserve -
-- unlike services/employees/stylists, this doesn't need an is_active
-- column; deleting one just frees its slot under the plan's lifetime cap
-- (same total-count-cap model as clients/jobs, not the active-count model
-- those active-row tables use).
create table if not exists public.line_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  description text not null,
  unit_price numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.line_items enable row level security;

create index if not exists line_items_user_id_idx on public.line_items (user_id);

create policy "Users can view own line items"
  on public.line_items for select
  using (auth.uid() = user_id);

create policy "Users can insert own line items"
  on public.line_items for insert
  with check (auth.uid() = user_id);

create policy "Users can update own line items"
  on public.line_items for update
  using (auth.uid() = user_id);

create policy "Users can delete own line items"
  on public.line_items for delete
  using (auth.uid() = user_id);
