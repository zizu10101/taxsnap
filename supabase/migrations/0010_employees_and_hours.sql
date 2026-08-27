-- Employee hour tracking + labor cost, tagged to a job the same way
-- receipts are (see 0009_jobs.sql). Entered entirely by the account owner -
-- no employee login or self-serve access exists or is planned.
--
-- IMPORTANT: labor cost is intentionally NOT wired into the HST/tax tables
-- (sales, documents, payments) or src/lib/hst.ts anywhere in this
-- migration or the app code built on top of it - it's for job cost
-- analysis only. See CLAUDE.md's "Tax logic" section for what's allowed to
-- feed that calculator.

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  default_hourly_rate numeric(10, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.employees enable row level security;

create index if not exists employees_user_id_idx on public.employees (user_id);

create policy "Users can view own employees"
  on public.employees for select
  using (auth.uid() = user_id);

create policy "Users can insert own employees"
  on public.employees for insert
  with check (auth.uid() = user_id);

create policy "Users can update own employees"
  on public.employees for update
  using (auth.uid() = user_id);

create policy "Users can delete own employees"
  on public.employees for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- hour_entries: hours worked by one employee, on one job, on one date
-- ---------------------------------------------------------------------------
create table if not exists public.hour_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete restrict,
  work_date date not null default current_date,
  hours numeric(6, 2) not null check (hours > 0),
  -- Copied from the employee's default_hourly_rate at entry time (editable
  -- per entry for commission workers/raises/job-specific rates) - never a
  -- live reference, so a later change to the employee's default rate can't
  -- retroactively alter a historical entry's cost.
  rate numeric(10, 2) not null,
  -- Generated (stored) column, not app-computed, so labor_cost can never
  -- drift from hours * rate.
  labor_cost numeric(12, 2) generated always as (round(hours * rate, 2)) stored,
  created_at timestamptz not null default now()
);

alter table public.hour_entries enable row level security;

create index if not exists hour_entries_user_id_idx on public.hour_entries (user_id);
create index if not exists hour_entries_employee_id_idx on public.hour_entries (employee_id);
create index if not exists hour_entries_job_id_idx on public.hour_entries (job_id);

create policy "Users can view own hour entries"
  on public.hour_entries for select
  using (auth.uid() = user_id);

create policy "Users can insert own hour entries"
  on public.hour_entries for insert
  with check (auth.uid() = user_id);

create policy "Users can update own hour entries"
  on public.hour_entries for update
  using (auth.uid() = user_id);

create policy "Users can delete own hour entries"
  on public.hour_entries for delete
  using (auth.uid() = user_id);
