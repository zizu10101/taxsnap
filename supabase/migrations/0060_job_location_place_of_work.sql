-- Job location, a job's customer, and a document's place of work.
-- Rollback: supabase/rollbacks/0060_job_location_place_of_work_rollback.sql
--
-- * jobs.location       - where the work is done (a street address or site name), free text.
-- * jobs.client_id      - the job's customer. Optional: a job can still exist with no customer
--                         (receipts auto-create jobs by name). If the client is deleted the job
--                         keeps existing and just loses the link (on delete set null), the same
--                         as documents.client_id.
-- * documents.place_of_work - the address of the work an estimate/invoice is FOR. It is copied from
--                         the job's location when the document is created (the app does that) and
--                         can be overridden per document. It is a snapshot, like document_items: a
--                         later edit to the job's location does not rewrite a sent document.
--
-- Deliberately:
--   * all nullable, no backfill - every existing job and document behaves exactly as before;
--   * length-checked (200 characters) so a pasted block of text can't be stored as an "address";
--   * no new policies: row-level security on jobs/documents already scopes every read and write to
--     the owner. A foreign key alone doesn't prove the client is the SAME owner's, so the app
--     re-verifies jobs.client_id against the caller's own clients before saving it (as it does for
--     documents.job_id).

begin;

alter table public.jobs
  add column if not exists location text,
  add column if not exists client_id uuid references public.clients (id) on delete set null;

alter table public.jobs
  add constraint jobs_location_length check (location is null or char_length(location) <= 200);

create index if not exists jobs_client_id_idx on public.jobs (client_id) where client_id is not null;

alter table public.documents
  add column if not exists place_of_work text;

alter table public.documents
  add constraint documents_place_of_work_length check (place_of_work is null or char_length(place_of_work) <= 200);

commit;
