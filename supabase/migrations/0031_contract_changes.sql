-- Change-order log for progress-billed jobs. jobs.contract_value stays
-- the current effective total (every existing reader - the Progress
-- Billing tab, the job summary page, the per-invoice Progress Billing
-- Summary block, the PDF - keeps working unchanged); this table is the
-- append-only audit trail of how it got there. Each row is a delta
-- (+/-), not a running total, applied to jobs.contract_value at the
-- moment it's logged - see POST /api/jobs/[id]/contract-changes.
create table public.contract_changes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric(12, 2) not null,
  reason text not null,
  changed_at date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.contract_changes enable row level security;

-- No user_id column - same pattern as document_items/payments, ownership
-- checked through the parent jobs row.
create policy "select own contract_changes"
  on public.contract_changes for select
  using (exists (
    select 1 from public.jobs j where j.id = contract_changes.job_id and j.user_id = auth.uid()
  ));

create policy "insert own contract_changes"
  on public.contract_changes for insert
  with check (exists (
    select 1 from public.jobs j where j.id = contract_changes.job_id and j.user_id = auth.uid()
  ));

-- Deliberately no update/delete policy - a change order is permanent
-- once logged, same "never silently rewrite financial history"
-- principle as payouts/commission_entries. A mistake gets corrected by
-- logging a new offsetting entry, not by editing this row.
