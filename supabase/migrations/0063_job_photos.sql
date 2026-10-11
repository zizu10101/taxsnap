-- Site photos: capture first, file later. A photo belongs to a job, or to nobody ("Unsorted").
-- Rollback: supabase/rollbacks/0063_job_photos_rollback.sql
-- The private storage bucket and its policies are in 0063_job_photos_storage.sql (apply this file first).
--
--   * job_id is NULLABLE (null = Unsorted) and `on delete cascade`: deleting a job deletes its photo ROWS.
--     The app deletes the FILES itself (the delete-job route removes the storage objects), because SQL
--     cannot remove a file from storage.
--   * storage_path = the display image (about 1,600 px, <= 250 KB); thumb_path = the thumbnail
--     (about 300 px, ~20 KB). Both live under "<user_id>/" in the job-photos bucket; a check keeps a
--     row from pointing at another user's folder.
--   * RLS is owner-only for every operation, and an insert/update may only point job_id at one of the
--     caller's OWN jobs. The app routes check this too; the policy is the backstop.
--   * Nothing is backfilled and nothing existing is touched.

begin;

create table if not exists public.job_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  storage_path text not null,
  thumb_path text not null,
  caption text,
  taken_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint job_photos_caption_length check (caption is null or char_length(caption) between 1 and 200),
  constraint job_photos_paths_in_own_folder check (
    storage_path like user_id::text || '/%' and thumb_path like user_id::text || '/%'
  )
);

create index if not exists job_photos_user_job_idx on public.job_photos (user_id, job_id);

alter table public.job_photos enable row level security;

create policy "Users can view their own job photos"
  on public.job_photos for select
  using (auth.uid() = user_id);

create policy "Users can add their own job photos"
  on public.job_photos for insert
  with check (
    auth.uid() = user_id
    and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = auth.uid()))
  );

create policy "Users can update their own job photos"
  on public.job_photos for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (job_id is null or exists (select 1 from public.jobs j where j.id = job_id and j.user_id = auth.uid()))
  );

create policy "Users can delete their own job photos"
  on public.job_photos for delete
  using (auth.uid() = user_id);

commit;
