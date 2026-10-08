-- Rollback for 0060_job_location_place_of_work.sql. NOT in supabase/migrations/ on purpose: that
-- folder is applied in order, and this must only ever be run by hand.
--
-- Removes the three new pieces of data: each job's location and customer link, and each document's
-- place of work. Nothing else references them, so every job, estimate, invoice, payment and receipt
-- is untouched. Roll the code back FIRST: it selects and writes these columns, and would error on
-- missing ones.

begin;

alter table public.documents drop constraint if exists documents_place_of_work_length;
alter table public.documents drop column if exists place_of_work;

drop index if exists public.jobs_client_id_idx;
alter table public.jobs drop constraint if exists jobs_location_length;
alter table public.jobs drop column if exists client_id;
alter table public.jobs drop column if exists location;

commit;
