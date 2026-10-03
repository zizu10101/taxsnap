-- Accountant portal: ONE read-only login per business (an accountant, and
-- anyone at their firm they share the PIN with), signed in with a per-business
-- link plus a 4-digit PIN. Same shape as the client portal (0050) and employee
-- login (0043): no email, no password, no Supabase JWT ever issued.
--
-- Scope is enforced in the app, not here: the portal reads through a scoped,
-- read-only reader (lib/scoped-reader.ts) that only exposes a fixed list of
-- tables and always filters on this business's user_id. Nothing in this
-- migration touches any existing table.
--
-- Sessions are a FIXED 14 days from sign-in (expires_at is set once at login
-- and the cookie expires with it). Unlike the employee/client sessions there is
-- no sliding expiry code at all - an accountant works in bursts, and a login
-- that sees every financial record shouldn't stay open between visits.

-- ---------------------------------------------------------------------------
-- accountant_logins: row exists == this business has an accountant login
-- ---------------------------------------------------------------------------
create table if not exists public.accountant_logins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  link_token text not null unique,
  pin_hash text not null,
  pin_failed_attempts int not null default 0,
  pin_locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.accountant_logins enable row level security;

create policy "Users can view own accountant login"
  on public.accountant_logins for select
  using (auth.uid() = user_id);

-- Revoked at the TABLE level and re-granted per safe column (a column-level
-- REVOKE does nothing while a table-level GRANT exists - see 0043/0050).
revoke all on public.accountant_logins from authenticated, anon;
grant select (user_id, link_token, pin_failed_attempts, pin_locked_until, last_login_at, created_at, updated_at)
  on public.accountant_logins to authenticated;

-- ---------------------------------------------------------------------------
-- accountant_sessions: service-role only (RLS on, no policies)
-- ---------------------------------------------------------------------------
create table if not exists public.accountant_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists accountant_sessions_user_id_idx on public.accountant_sessions (user_id);
alter table public.accountant_sessions enable row level security;

create table if not exists public.accountant_login_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists accountant_login_failures_ip_idx
  on public.accountant_login_failures (ip, created_at);
alter table public.accountant_login_failures enable row level security;

-- ---------------------------------------------------------------------------
-- Owner-callable functions (scoped by auth.uid())
-- ---------------------------------------------------------------------------
create or replace function public.create_accountant_login(p_pin text, p_link_token text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;
  if p_link_token is null or length(p_link_token) < 20 then
    raise exception 'INVALID_TOKEN';
  end if;
  if exists (select 1 from public.accountant_logins where user_id = auth.uid()) then
    raise exception 'LOGIN_ALREADY_EXISTS';
  end if;
  insert into public.accountant_logins (user_id, link_token, pin_hash)
  values (auth.uid(), p_link_token, extensions.crypt(p_pin, extensions.gen_salt('bf')));
end;
$$;

create or replace function public.reset_accountant_pin(p_pin text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;
  update public.accountant_logins
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin_failed_attempts = 0,
      pin_locked_until = null,
      updated_at = now()
  where user_id = auth.uid();
  if not found then
    raise exception 'LOGIN_NOT_FOUND';
  end if;
  delete from public.accountant_sessions where user_id = auth.uid();
end;
$$;

-- New link, old one dead, every live session ended. PIN unchanged.
create or replace function public.regenerate_accountant_link(p_link_token text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_link_token is null or length(p_link_token) < 20 then
    raise exception 'INVALID_TOKEN';
  end if;
  update public.accountant_logins
  set link_token = p_link_token, updated_at = now()
  where user_id = auth.uid();
  if not found then
    raise exception 'LOGIN_NOT_FOUND';
  end if;
  delete from public.accountant_sessions where user_id = auth.uid();
end;
$$;

create or replace function public.remove_accountant_login()
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  delete from public.accountant_logins where user_id = auth.uid();
  if not found then
    raise exception 'LOGIN_NOT_FOUND';
  end if;
  delete from public.accountant_sessions where user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_accountant_pin: service_role only, called by the public login route
-- (no auth.uid() there). Same lockout as the other portals: 5 consecutive
-- misses lock for 15 minutes; the owner resetting the PIN clears it.
-- ---------------------------------------------------------------------------
create or replace function public.verify_accountant_pin(p_user_id uuid, p_pin text)
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
  select al.pin_hash, al.pin_locked_until, al.pin_failed_attempts
  into v_hash, v_locked_until, v_attempts
  from public.accountant_logins al
  where al.user_id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'PIN_LOCKED';
  end if;

  v_match := (v_hash = extensions.crypt(p_pin, v_hash));

  if v_match then
    update public.accountant_logins
    set pin_failed_attempts = 0, pin_locked_until = null, last_login_at = now()
    where user_id = p_user_id;
  else
    v_attempts := v_attempts + 1;
    update public.accountant_logins
    set pin_failed_attempts = v_attempts,
        pin_locked_until = case when v_attempts >= 5
          then now() + interval '15 minutes' else null end
    where user_id = p_user_id;
  end if;

  return v_match;
end;
$$;

revoke execute on function public.verify_accountant_pin(uuid, text)
  from public, anon, authenticated;
grant execute on function public.verify_accountant_pin(uuid, text) to service_role;
