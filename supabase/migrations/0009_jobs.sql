-- First-class `jobs` table backing the existing free-text job_name tag on
-- receipts, so the new employee hour tracking feature has a stable id to
-- join against for job cost rollups. receipts.job_name and the existing
-- free-text job filter UI (dashboard-body.tsx, job-filter.tsx) are left
-- completely untouched - a trigger keeps job_id in sync with job_name
-- automatically, so no receipt code needs to change.

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.jobs enable row level security;

create index if not exists jobs_user_id_idx on public.jobs (user_id);

create policy "Users can view own jobs"
  on public.jobs for select
  using (auth.uid() = user_id);

create policy "Users can insert own jobs"
  on public.jobs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own jobs"
  on public.jobs for update
  using (auth.uid() = user_id);

create policy "Users can delete own jobs"
  on public.jobs for delete
  using (auth.uid() = user_id);

alter table public.receipts
  add column if not exists job_id uuid references public.jobs (id) on delete set null;

create index if not exists receipts_job_id_idx on public.receipts (job_id);

-- Backfill: one job row per distinct job_name already used on a receipt,
-- then point each existing receipt's new job_id at it.
insert into public.jobs (user_id, name)
select distinct user_id, job_name
from public.receipts
where job_name is not null and btrim(job_name) <> ''
on conflict (user_id, name) do nothing;

update public.receipts r
set job_id = j.id
from public.jobs j
where j.user_id = r.user_id
  and j.name = r.job_name
  and r.job_id is null;

-- Keep job_id in sync going forward whenever job_name is set/changed on a
-- receipt, so the existing free-text job tagging flow needs no app code
-- changes but new/edited receipts still get a real job_id.
create or replace function public.sync_receipt_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if new.job_name is null or btrim(new.job_name) = '' then
    new.job_id := null;
    return new;
  end if;

  select id into v_job_id
  from public.jobs
  where user_id = new.user_id and name = new.job_name;

  if v_job_id is null then
    insert into public.jobs (user_id, name)
    values (new.user_id, new.job_name)
    on conflict (user_id, name) do update set name = excluded.name
    returning id into v_job_id;
  end if;

  new.job_id := v_job_id;
  return new;
end;
$$;

drop trigger if exists receipts_sync_job on public.receipts;
create trigger receipts_sync_job
  before insert or update of job_name on public.receipts
  for each row execute procedure public.sync_receipt_job();
