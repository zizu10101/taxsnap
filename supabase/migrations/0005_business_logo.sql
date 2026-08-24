-- Business logo shown on every invoice and estimate for a user.
alter table public.profiles add column if not exists logo_url text;

insert into storage.buckets (id, name, public)
values ('logos', 'logos', false)
on conflict (id) do nothing;

create policy "Users can upload their own logo"
  on storage.objects for insert
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view their own logo"
  on storage.objects for select
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own logo"
  on storage.objects for update
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own logo"
  on storage.objects for delete
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
