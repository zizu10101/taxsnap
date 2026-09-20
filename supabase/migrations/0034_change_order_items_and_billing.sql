-- Change orders get real line items, same shape as document_items, so
-- the change-order dialog can be a genuine mini invoice-builder (saved-
-- item picker, "save for next time") rather than a single typed amount.
-- contract_changes.amount stays a stored column (recomputed server-side
-- on every write, same "store the computed total" pattern documents.
-- subtotal already uses) so every existing reader keeps working
-- unchanged.
create table public.contract_change_items (
  id uuid primary key default gen_random_uuid(),
  contract_change_id uuid not null references public.contract_changes(id) on delete cascade,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.contract_change_items enable row level security;

-- No user_id column - same ownership-through-parent pattern as
-- document_items/payments (contract_change_items -> contract_changes ->
-- jobs -> user_id).
create policy "select own contract_change_items"
  on public.contract_change_items for select
  using (exists (
    select 1 from public.contract_changes cc
    join public.jobs j on j.id = cc.job_id
    where cc.id = contract_change_items.contract_change_id and j.user_id = auth.uid()
  ));

create policy "insert own contract_change_items"
  on public.contract_change_items for insert
  with check (exists (
    select 1 from public.contract_changes cc
    join public.jobs j on j.id = cc.job_id
    where cc.id = contract_change_items.contract_change_id and j.user_id = auth.uid()
  ));

create policy "update own contract_change_items"
  on public.contract_change_items for update
  using (exists (
    select 1 from public.contract_changes cc
    join public.jobs j on j.id = cc.job_id
    where cc.id = contract_change_items.contract_change_id and j.user_id = auth.uid()
  ));

create policy "delete own contract_change_items"
  on public.contract_change_items for delete
  using (exists (
    select 1 from public.contract_changes cc
    join public.jobs j on j.id = cc.job_id
    where cc.id = contract_change_items.contract_change_id and j.user_id = auth.uid()
  ));

-- Links a change order to the real draw/invoice it was billed through
-- (via "Bill this Change Order", same mechanism as Bill Remaining
-- Balance). Simplified lock rule: a change order is locked (no
-- edit/delete) once this is set - full stop, no other condition.
alter table public.contract_changes
  add column if not exists billed_document_id uuid references public.documents(id) on delete set null;

-- 0031_progress_billing.sql only granted select/insert (append-only by
-- design at the time) - edit/delete are now allowed, but only up to the
-- moment a change order is billed. The `using` clause checks the row's
-- state *before* the write, so this also structurally prevents ever
-- clearing billed_document_id back to null once set, not just editing
-- amount/reason - a real DB-level backstop behind the API route's own
-- check, not just app-level enforcement.
create policy "update own unbilled contract_changes"
  on public.contract_changes for update
  using (
    billed_document_id is null
    and exists (select 1 from public.jobs j where j.id = contract_changes.job_id and j.user_id = auth.uid())
  );

create policy "delete own unbilled contract_changes"
  on public.contract_changes for delete
  using (
    billed_document_id is null
    and exists (select 1 from public.jobs j where j.id = contract_changes.job_id and j.user_id = auth.uid())
  );
