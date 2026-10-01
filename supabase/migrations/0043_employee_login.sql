-- Employee clock-in/out portal: employees sign in with a shared per-business
-- link + their own 4-digit PIN (no email, no password, no auth.users row),
-- clock in/out of jobs, and the owner can review/fix sessions.
--
-- Design notes (see CLAUDE.md "Employee login & clock-in/out"):
--  * Employee PINs live in their own table (employee_pins), NOT as a
--    column-revoked pin_hash on employees like stylists.pin_hash - a revoked
--    column makes every bare select("*") / employee:employees(*) embed across
--    the app fail outright, and employees is selected that way in many places.
--  * Employee sessions are server-side rows (hash of an opaque cookie token),
--    so resetting a PIN / deactivating an employee / regenerating the link
--    cuts access on the very next request. No Supabase JWT is ever issued.
--  * Clock sessions are a separate table from hour_entries; closing/editing a
--    session writes the linked hour_entries row in the same transaction, so
--    job costing is untouched and an open session never leaks into it.
--  * All timestamps are server time. work_date = clock-in date in
--    America/Toronto (a session crossing midnight belongs to the day it began).

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Per-business link token
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists employee_login_token text unique;
-- 0042_revoke_pin_hash_exposure.sql left app_settings readable per-column
-- only, so the new column needs its own grant for the owner's Settings page.
-- (The token is the owner's own secret link; RLS limits each user to their row.)
grant select (employee_login_token) on public.app_settings to authenticated;

-- ---------------------------------------------------------------------------
-- employee_pins: existence of a row == "has a PIN"
-- ---------------------------------------------------------------------------
create table if not exists public.employee_pins (
  employee_id uuid primary key references public.employees (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  pin_hash text not null,
  pin_failed_attempts int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.employee_pins enable row level security;

create policy "Users can view own employee pins"
  on public.employee_pins for select
  using (auth.uid() = user_id);

-- Hash is never readable/writable outside the functions below. Revoked at
-- the TABLE level and re-granted per safe column: in Postgres a column-level
-- REVOKE has no effect while a table-level GRANT exists (Supabase grants
-- table-level by default), so the stylist-style "revoke select (pin_hash)"
-- alone would not actually hide the column.
revoke all on public.employee_pins from authenticated, anon;
grant select (employee_id, user_id, pin_failed_attempts, pin_locked_until, created_at, updated_at)
  on public.employee_pins to authenticated;

-- ---------------------------------------------------------------------------
-- employee_sessions: service-role only (RLS on, no policies)
-- ---------------------------------------------------------------------------
create table if not exists public.employee_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists employee_sessions_employee_id_idx on public.employee_sessions (employee_id);
create index if not exists employee_sessions_user_id_idx on public.employee_sessions (user_id);
alter table public.employee_sessions enable row level security;

-- Failed-login log for a per-IP throttle on the public login route.
create table if not exists public.employee_login_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists employee_login_failures_ip_idx
  on public.employee_login_failures (ip, created_at);
alter table public.employee_login_failures enable row level security;

-- Deactivating an employee ends their sessions immediately.
create or replace function public.end_sessions_on_employee_deactivate()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.is_active = false and old.is_active = true then
    delete from public.employee_sessions where employee_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists employees_end_sessions on public.employees;
create trigger employees_end_sessions
  after update of is_active on public.employees
  for each row execute function public.end_sessions_on_employee_deactivate();

-- ---------------------------------------------------------------------------
-- time_sessions
-- ---------------------------------------------------------------------------
create table if not exists public.time_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  employee_id uuid not null references public.employees (id) on delete restrict,
  job_id uuid not null references public.jobs (id) on delete restrict,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  -- Snapshotted at clock-in, same convention as hour_entries.rate.
  rate numeric(10, 2) not null,
  billable_rate numeric(10, 2) not null default 0,
  closed_by text check (closed_by in ('employee', 'owner')),
  owner_edited_at timestamptz,
  original_clock_in_at timestamptz,
  original_clock_out_at timestamptz,
  created_at timestamptz not null default now(),
  check (clock_out_at is null or clock_out_at > clock_in_at)
);
create index if not exists time_sessions_user_id_idx on public.time_sessions (user_id);
create index if not exists time_sessions_employee_id_idx on public.time_sessions (employee_id, clock_in_at desc);

-- Never two open sessions for one employee - enforced by the database.
create unique index if not exists time_sessions_one_open_per_employee
  on public.time_sessions (employee_id) where clock_out_at is null;

-- No overlapping sessions for one employee (also catches bad owner edits).
alter table public.time_sessions
  drop constraint if exists time_sessions_no_overlap;
alter table public.time_sessions
  add constraint time_sessions_no_overlap
  exclude using gist (
    employee_id with =,
    tstzrange(clock_in_at, coalesce(clock_out_at, 'infinity'::timestamptz)) with &&
  );

alter table public.time_sessions enable row level security;
create policy "Users can view own time sessions"
  on public.time_sessions for select
  using (auth.uid() = user_id);
-- No insert/update/delete policies: writes only via the functions below.
revoke insert, update, delete on public.time_sessions from authenticated, anon;

alter table public.hour_entries
  add column if not exists time_session_id uuid unique
  references public.time_sessions (id) on delete set null;

-- ---------------------------------------------------------------------------
-- PIN functions (owner-callable, scoped by auth.uid())
-- ---------------------------------------------------------------------------
create or replace function public.create_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;
  perform 1 from public.employees where id = p_employee_id and user_id = auth.uid();
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  if exists (select 1 from public.employee_pins where employee_id = p_employee_id) then
    raise exception 'PIN_ALREADY_SET';
  end if;
  insert into public.employee_pins (employee_id, user_id, pin_hash)
  values (p_employee_id, auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')));
end;
$$;

create or replace function public.reset_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;
  update public.employee_pins
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin_failed_attempts = 0,
      pin_locked_until = null,
      updated_at = now()
  where employee_id = p_employee_id and user_id = auth.uid();
  if not found then
    raise exception 'PIN_NOT_SET';
  end if;
  delete from public.employee_sessions where employee_id = p_employee_id;
end;
$$;

create or replace function public.remove_employee_pin(p_employee_id uuid)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  delete from public.employee_pins
  where employee_id = p_employee_id and user_id = auth.uid();
  if not found then
    raise exception 'PIN_NOT_SET';
  end if;
  delete from public.employee_sessions where employee_id = p_employee_id;
end;
$$;

-- verify_employee_pin: called only by the public login route via the
-- service-role client (the caller has no auth.uid()). Same lockout rule as
-- verify_stylist_pin: 5 consecutive misses locks for 15 minutes; the owner
-- resetting the PIN clears it.
create or replace function public.verify_employee_pin(
  p_user_id uuid,
  p_employee_id uuid,
  p_pin text
)
returns boolean
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_hash text;
  v_locked_until timestamptz;
  v_attempts int;
  v_match boolean;
begin
  select ep.pin_hash, ep.pin_locked_until, ep.pin_failed_attempts
  into v_hash, v_locked_until, v_attempts
  from public.employee_pins ep
  join public.employees e on e.id = ep.employee_id
  where ep.employee_id = p_employee_id
    and ep.user_id = p_user_id
    and e.is_active
  for update of ep;

  if not found then
    return false;
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'PIN_LOCKED';
  end if;

  v_match := (v_hash = extensions.crypt(p_pin, v_hash));

  if v_match then
    update public.employee_pins
    set pin_failed_attempts = 0, pin_locked_until = null
    where employee_id = p_employee_id;
  else
    v_attempts := v_attempts + 1;
    update public.employee_pins
    set pin_failed_attempts = v_attempts,
        pin_locked_until = case when v_attempts >= 5
          then now() + interval '15 minutes' else null end
    where employee_id = p_employee_id;
  end if;

  return v_match;
end;
$$;

revoke execute on function public.verify_employee_pin(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.verify_employee_pin(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Clock sessions
-- ---------------------------------------------------------------------------

-- Internal: make hour_entries match a session. Closed + > 0 hours -> one
-- linked entry (insert or update); otherwise no entry. Hours are always
-- derived from the timestamps, never typed.
create or replace function public._sync_time_session_entry(p_session_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  s public.time_sessions%rowtype;
  v_hours numeric;
begin
  select * into s from public.time_sessions where id = p_session_id;
  if not found then
    return;
  end if;

  if s.clock_out_at is null then
    delete from public.hour_entries where time_session_id = s.id;
    return;
  end if;

  v_hours := round(extract(epoch from (s.clock_out_at - s.clock_in_at)) / 3600.0, 2);

  if v_hours <= 0 then
    -- Accidental double-tap: hour_entries.hours must be > 0, so no entry.
    delete from public.hour_entries where time_session_id = s.id;
    return;
  end if;

  update public.hour_entries
  set hours = v_hours,
      work_date = (s.clock_in_at at time zone 'America/Toronto')::date
  where time_session_id = s.id;

  if not found then
    insert into public.hour_entries
      (user_id, employee_id, job_id, work_date, hours, rate, billable_rate, time_session_id)
    values
      (s.user_id, s.employee_id, s.job_id,
       (s.clock_in_at at time zone 'America/Toronto')::date,
       v_hours, s.rate, s.billable_rate, s.id);
  end if;
end;
$$;
revoke execute on function public._sync_time_session_entry(uuid) from public, anon, authenticated;

create or replace function public.employee_clock_in(
  p_user_id uuid,
  p_employee_id uuid,
  p_job_id uuid
)
returns public.time_sessions
language plpgsql
security definer set search_path = public
as $$
declare
  v_rate numeric(10, 2);
  v_billable numeric(10, 2);
  v_row public.time_sessions;
begin
  select default_hourly_rate, default_billable_rate
  into v_rate, v_billable
  from public.employees
  where id = p_employee_id and user_id = p_user_id and is_active;
  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  perform 1 from public.jobs where id = p_job_id and user_id = p_user_id;
  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  begin
    insert into public.time_sessions (user_id, employee_id, job_id, rate, billable_rate)
    values (p_user_id, p_employee_id, p_job_id, v_rate, v_billable)
    returning * into v_row;
  exception when unique_violation or exclusion_violation then
    raise exception 'ALREADY_CLOCKED_IN';
  end;

  return v_row;
end;
$$;
revoke execute on function public.employee_clock_in(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.employee_clock_in(uuid, uuid, uuid) to service_role;

create or replace function public.employee_clock_out(p_user_id uuid, p_employee_id uuid)
returns public.time_sessions
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.time_sessions;
begin
  select * into v_row
  from public.time_sessions
  where employee_id = p_employee_id and user_id = p_user_id and clock_out_at is null
  for update;
  if not found then
    raise exception 'NOT_CLOCKED_IN';
  end if;

  update public.time_sessions
  set clock_out_at = greatest(now(), clock_in_at + interval '1 millisecond'),
      closed_by = 'employee'
  where id = v_row.id
  returning * into v_row;

  perform public._sync_time_session_entry(v_row.id);
  return v_row;
end;
$$;
revoke execute on function public.employee_clock_out(uuid, uuid) from public, anon, authenticated;
grant execute on function public.employee_clock_out(uuid, uuid) to service_role;

-- Owner: close an open session at a corrected end time.
create or replace function public.owner_close_time_session(p_id uuid, p_clock_out_at timestamptz)
returns public.time_sessions
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.time_sessions;
begin
  select * into v_row
  from public.time_sessions
  where id = p_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;
  if v_row.clock_out_at is not null then
    raise exception 'ALREADY_CLOSED';
  end if;
  if p_clock_out_at <= v_row.clock_in_at then
    raise exception 'INVALID_RANGE';
  end if;
  if p_clock_out_at > now() + interval '1 minute' then
    raise exception 'FUTURE_END';
  end if;

  begin
    update public.time_sessions
    set clock_out_at = p_clock_out_at,
        closed_by = 'owner',
        owner_edited_at = now(),
        original_clock_in_at = coalesce(original_clock_in_at, clock_in_at)
    where id = p_id
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'OVERLAP';
  end;

  perform public._sync_time_session_entry(v_row.id);
  return v_row;
end;
$$;

-- Owner: edit either timestamp on an open or completed session. A completed
-- session must keep an end time; an open one may only have its start edited.
create or replace function public.owner_edit_time_session(
  p_id uuid,
  p_clock_in_at timestamptz,
  p_clock_out_at timestamptz
)
returns public.time_sessions
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.time_sessions;
begin
  select * into v_row
  from public.time_sessions
  where id = p_id and user_id = auth.uid()
  for update;
  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_row.clock_out_at is null then
    -- Open: start only (use owner_close_time_session to give it an end).
    if p_clock_out_at is not null then
      raise exception 'USE_CLOSE';
    end if;
  elsif p_clock_out_at is null then
    raise exception 'INVALID_RANGE';
  end if;

  if p_clock_in_at > now() + interval '1 minute'
     or (p_clock_out_at is not null and p_clock_out_at > now() + interval '1 minute') then
    raise exception 'FUTURE_END';
  end if;
  if p_clock_out_at is not null and p_clock_out_at <= p_clock_in_at then
    raise exception 'INVALID_RANGE';
  end if;

  begin
    update public.time_sessions
    set clock_in_at = p_clock_in_at,
        clock_out_at = p_clock_out_at,
        owner_edited_at = now(),
        original_clock_in_at = coalesce(original_clock_in_at, v_row.clock_in_at),
        original_clock_out_at = coalesce(original_clock_out_at, v_row.clock_out_at)
    where id = p_id
    returning * into v_row;
  exception when exclusion_violation or check_violation then
    raise exception 'OVERLAP';
  end;

  perform public._sync_time_session_entry(v_row.id);
  return v_row;
end;
$$;
