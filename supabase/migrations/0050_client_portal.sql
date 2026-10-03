-- Client portal: a read-only login per client (name is implied by the link,
-- plus a 4-digit PIN). Same shape as the employee login in 0043, except the
-- link is per CLIENT rather than per business, so the link itself identifies
-- who is signing in and no name dropdown is needed (a shared dropdown would
-- leak the owner's other client names).
--
-- Nothing here touches documents/payments/document_items: the portal reads
-- them server-side, filtered by the client_id of a verified session row.
-- No Supabase JWT is ever issued to a client.

-- ---------------------------------------------------------------------------
-- client_portal_logins: existence of a row == "this client has a login"
-- ---------------------------------------------------------------------------
create table if not exists public.client_portal_logins (
  client_id uuid primary key references public.clients (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  link_token text not null unique,
  pin_hash text not null,
  pin_failed_attempts int not null default 0,
  pin_locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_portal_logins_user_id_idx
  on public.client_portal_logins (user_id);

alter table public.client_portal_logins enable row level security;

create policy "Users can view own client portal logins"
  on public.client_portal_logins for select
  using (auth.uid() = user_id);

-- Revoked at the TABLE level and re-granted per safe column (a column-level
-- REVOKE does nothing while a table-level GRANT exists - see 0043). The hash
-- is only ever touched by the functions below. link_token is the owner's own
-- link to copy and send; RLS limits each owner to their own rows.
revoke all on public.client_portal_logins from authenticated, anon;
grant select (client_id, user_id, link_token, pin_failed_attempts, pin_locked_until, created_at, updated_at)
  on public.client_portal_logins to authenticated;

-- ---------------------------------------------------------------------------
-- client_sessions: service-role only (RLS on, no policies)
-- ---------------------------------------------------------------------------
create table if not exists public.client_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists client_sessions_client_id_idx on public.client_sessions (client_id);
create index if not exists client_sessions_user_id_idx on public.client_sessions (user_id);
alter table public.client_sessions enable row level security;

-- Failed-login log for the per-IP throttle on the public login route.
create table if not exists public.client_login_failures (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists client_login_failures_ip_idx
  on public.client_login_failures (ip, created_at);
alter table public.client_login_failures enable row level security;

-- ---------------------------------------------------------------------------
-- Owner-callable functions (scoped by auth.uid())
-- ---------------------------------------------------------------------------
-- The link token is generated in app code (generateOpaqueToken) and passed in,
-- same as sign_token/view_token.
create or replace function public.create_client_portal_login(
  p_client_id uuid,
  p_pin text,
  p_link_token text
)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;
  if p_link_token is null or length(p_link_token) < 20 then
    raise exception 'INVALID_TOKEN';
  end if;
  perform 1 from public.clients where id = p_client_id and user_id = auth.uid();
  if not found then
    raise exception 'CLIENT_NOT_FOUND';
  end if;
  if exists (select 1 from public.client_portal_logins where client_id = p_client_id) then
    raise exception 'LOGIN_ALREADY_EXISTS';
  end if;
  insert into public.client_portal_logins (client_id, user_id, link_token, pin_hash)
  values (p_client_id, auth.uid(), p_link_token,
          extensions.crypt(p_pin, extensions.gen_salt('bf')));
end;
$$;

create or replace function public.reset_client_portal_pin(p_client_id uuid, p_pin text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;
  update public.client_portal_logins
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin_failed_attempts = 0,
      pin_locked_until = null,
      updated_at = now()
  where client_id = p_client_id and user_id = auth.uid();
  if not found then
    raise exception 'LOGIN_NOT_FOUND';
  end if;
  delete from public.client_sessions where client_id = p_client_id;
end;
$$;

-- New link, old one dead, every live session ended. PIN unchanged.
create or replace function public.regenerate_client_portal_link(
  p_client_id uuid,
  p_link_token text
)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_link_token is null or length(p_link_token) < 20 then
    raise exception 'INVALID_TOKEN';
  end if;
  update public.client_portal_logins
  set link_token = p_link_token, updated_at = now()
  where client_id = p_client_id and user_id = auth.uid();
  if not found then
    raise exception 'LOGIN_NOT_FOUND';
  end if;
  delete from public.client_sessions where client_id = p_client_id;
end;
$$;

create or replace function public.remove_client_portal_login(p_client_id uuid)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  delete from public.client_portal_logins
  where client_id = p_client_id and user_id = auth.uid();
  if not found then
    raise exception 'LOGIN_NOT_FOUND';
  end if;
  delete from public.client_sessions where client_id = p_client_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_client_pin: service_role only, called by the public login route
-- (the caller has no auth.uid()). Same lockout as verify_employee_pin: 5
-- consecutive misses lock for 15 minutes; the owner resetting the PIN clears it.
-- ---------------------------------------------------------------------------
create or replace function public.verify_client_pin(
  p_user_id uuid,
  p_client_id uuid,
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
  select cpl.pin_hash, cpl.pin_locked_until, cpl.pin_failed_attempts
  into v_hash, v_locked_until, v_attempts
  from public.client_portal_logins cpl
  where cpl.client_id = p_client_id
    and cpl.user_id = p_user_id
  for update;

  if not found then
    return false;
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'PIN_LOCKED';
  end if;

  v_match := (v_hash = extensions.crypt(p_pin, v_hash));

  if v_match then
    update public.client_portal_logins
    set pin_failed_attempts = 0, pin_locked_until = null
    where client_id = p_client_id;
  else
    v_attempts := v_attempts + 1;
    update public.client_portal_logins
    set pin_failed_attempts = v_attempts,
        pin_locked_until = case when v_attempts >= 5
          then now() + interval '15 minutes' else null end
    where client_id = p_client_id;
  end if;

  return v_match;
end;
$$;

revoke execute on function public.verify_client_pin(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.verify_client_pin(uuid, uuid, text) to service_role;
