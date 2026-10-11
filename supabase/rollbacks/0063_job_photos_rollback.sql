-- Rollback for 0063_job_photos.sql and 0063_job_photos_storage.sql. NOT in supabase/migrations/ on
-- purpose: that folder is applied in order, and this must only ever be run by hand.
--
-- Drops the table (every photo row, caption and job link is lost) and the bucket's policies. It does NOT
-- delete the image files: Supabase does not allow removing storage objects with SQL, so empty the
-- job-photos bucket from Dashboard -> Storage first (or the files stay behind, unreachable), then
-- delete the bucket there. Roll the code back FIRST: the new code reads and writes job_photos.

begin;

drop policy if exists "Users can upload their own job photos" on storage.objects;
drop policy if exists "Users can view their own job photos" on storage.objects;
drop policy if exists "Users can delete their own job photos" on storage.objects;

drop table if exists public.job_photos;

commit;
