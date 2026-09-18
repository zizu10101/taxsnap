-- Progress billing: a job with contract_value set becomes "progress-
-- billed"; a job without it (the default, null) works exactly as before -
-- nothing about regular job costing changes.
alter table public.jobs add column if not exists contract_value numeric(12, 2);

-- A draw is just a documents row (type='invoice') with is_progress_draw
-- set, not a new table or document type - it automatically counts
-- against the existing monthly invoice cap, shows up in the normal
-- Invoices list, and reuses payments/status logic completely unchanged.
-- draw_number is a separate, job-scoped counter from document_number
-- (the global INV-1000/INV-1001 sequence from 0026_document_number.sql) -
-- a draw gets both: its real sequential invoice number for accounting
-- continuity, and a small per-job "Draw #1/#2/#3" number for the
-- progress-invoice header, computed the same max+1 way scoped to
-- (job_id, is_progress_draw = true) instead of (user_id, type).
alter table public.documents add column if not exists is_progress_draw boolean not null default false;
alter table public.documents add column if not exists draw_number integer;
alter table public.documents add column if not exists draw_description text;
alter table public.documents add column if not exists draw_percent_complete numeric(5, 2);
