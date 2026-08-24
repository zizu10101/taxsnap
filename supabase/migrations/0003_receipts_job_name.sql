-- Optional job name/number tag on receipts, so a contractor can filter and
-- report on all receipts tied to a specific job.
alter table public.receipts add column if not exists job_name text;

create index if not exists receipts_job_name_idx on public.receipts (job_name);
