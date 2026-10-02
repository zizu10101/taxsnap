-- Client and job names are unique per account, case-insensitively and
-- ignoring surrounding whitespace ("ABC Shop" == "abc shop "). Scope is
-- user_id only - there is no business/org column, and employees/stylists
-- never hold their own scope (all access is server-side via the owner's id),
-- so per-account is also per-business.
--
-- These CREATE UNIQUE INDEX statements fail if case-insensitive duplicates
-- still exist for one account - merge or rename them first.
create unique index if not exists clients_user_name_ci_idx
  on public.clients (user_id, lower(btrim(name)));

create unique index if not exists jobs_user_name_ci_idx
  on public.jobs (user_id, lower(btrim(name)));

-- Receipts path: resolve job_name case-insensitively instead of by exact
-- match, so "abc shop" on a receipt lands on the existing "ABC Shop" job
-- instead of creating a near-duplicate (or, now, hitting the index above).
-- job_name is rewritten to the job's canonical spelling so the free-text
-- job filter groups those receipts together.
create or replace function public.sync_receipt_job()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_job_id uuid;
  v_name text;
begin
  if new.job_name is null or btrim(new.job_name) = '' then
    new.job_id := null;
    return new;
  end if;

  select id, name into v_job_id, v_name
  from public.jobs
  where user_id = new.user_id
    and lower(btrim(name)) = lower(btrim(new.job_name));

  if v_job_id is null then
    insert into public.jobs (user_id, name)
    values (new.user_id, btrim(new.job_name))
    on conflict (user_id, (lower(btrim(name)))) do nothing
    returning id, name into v_job_id, v_name;

    -- Lost a race with a concurrent insert: re-select the winner.
    if v_job_id is null then
      select id, name into v_job_id, v_name
      from public.jobs
      where user_id = new.user_id
        and lower(btrim(name)) = lower(btrim(new.job_name));
    end if;
  end if;

  new.job_id := v_job_id;
  new.job_name := v_name;
  return new;
end;
$$;
