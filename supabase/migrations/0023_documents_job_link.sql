-- Links an invoice/estimate to a job, so a job's cost rollup
-- (/dashboard/jobs/[id]) can finally net real revenue against real cost
-- instead of guessing at an Est. Profit with no revenue source. Mirrors
-- receipts.job_id (0009_jobs.sql): nullable, "on delete set null" - not
-- "on delete restrict" like hour_entries.job_id (0010_employees_and_hours.
-- sql), since linking an invoice to a job is optional, not a strict
-- cost-ledger requirement. Deleting a job should just unlink its
-- invoices, not be blocked by them.
alter table public.documents
  add column if not exists job_id uuid references public.jobs (id) on delete set null;

create index if not exists documents_job_id_idx on public.documents (job_id);
