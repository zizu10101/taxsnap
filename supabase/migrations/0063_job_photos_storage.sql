-- Private storage bucket for site photos, protected the same way as the receipts bucket: every object
-- lives under a folder named after the owner's user id, and the policies only let a signed-in user touch
-- objects in THEIR folder. Apply 0063_job_photos.sql first.
-- Rollback: supabase/rollbacks/0063_job_photos_rollback.sql (it also removes this bucket's policies).
--
--   * public = false: there is no public URL for anything in this bucket. The app only ever hands out
--     short-lived signed URLs (createSignedUrl), which themselves require the SELECT policy below.
--   * file_size_limit / allowed_mime_types: the bucket itself refuses anything over 500 KB or that is not
--     a JPEG, even if the app's own checks were bypassed. The app compresses to <= ~250 KB first.
--   * (storage.foldername(name))[1] is the first path segment, so "<user id>/<photo id>.jpg" is yours and
--     "<other id>/..." is not. INSERT/SELECT/DELETE only: files are never overwritten, so there is no
--     UPDATE policy at all.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 512000, array['image/jpeg'])
on conflict (id) do nothing;

create policy "Users can upload their own job photos"
  on storage.objects for insert
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view their own job photos"
  on storage.objects for select
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own job photos"
  on storage.objects for delete
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
