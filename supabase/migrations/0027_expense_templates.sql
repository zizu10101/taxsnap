-- Reusable manual-expense templates (rent, phone bill, etc) - a fast
-- re-log shortcut, NOT an automatic recurring-billing system. Nothing
-- ever auto-creates a receipt from one; recurrence_hint is purely
-- informational (shown in the picker), never read by a scheduler.
--
-- No is_active/soft-delete - same reasoning as line_items
-- (0025_line_items.sql): a template has no downstream reference of its
-- own, so deleting one is a plain DELETE, capped by total row count like
-- clients/jobs/line_items rather than an active-row cap.
create table if not exists public.expense_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Label shown in the template picker (e.g. "Office Rent") - distinct
  -- from `description` below, which is what actually gets copied into
  -- the logged expense's merchant_name.
  name text not null,
  description text not null,
  default_amount numeric(12, 2) not null default 0,
  -- Not in the original ask - added because the manual expense form
  -- already has an HST/tax-paid field (see manual-expense-dialog.tsx),
  -- and a template that forgot it would reset tax to $0 every time,
  -- defeating the point for something like a phone bill with consistent
  -- HST.
  default_tax_amount numeric(12, 2) not null default 0,
  default_tax_category text not null default 'Other',
  job_id uuid references public.jobs (id) on delete set null,
  -- 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null - no check
  -- constraint, validated app-side only, same lighter-weight precedent
  -- receipts.tax_category already uses for a purely-cosmetic text field.
  recurrence_hint text,
  created_at timestamptz not null default now()
);

alter table public.expense_templates enable row level security;

create index if not exists expense_templates_user_id_idx on public.expense_templates (user_id);

create policy "Users can view own expense templates"
  on public.expense_templates for select
  using (auth.uid() = user_id);

create policy "Users can insert own expense templates"
  on public.expense_templates for insert
  with check (auth.uid() = user_id);

create policy "Users can update own expense templates"
  on public.expense_templates for update
  using (auth.uid() = user_id);

create policy "Users can delete own expense templates"
  on public.expense_templates for delete
  using (auth.uid() = user_id);

-- Traceability only - lets a future report answer "total spent via this
-- template over time" if that becomes useful. Never read by any current
-- code path; logging from a template still just inserts a plain receipts
-- row like any other manual expense.
alter table public.receipts
  add column if not exists source_template_id uuid references public.expense_templates (id) on delete set null;

create index if not exists receipts_source_template_id_idx on public.receipts (source_template_id);
