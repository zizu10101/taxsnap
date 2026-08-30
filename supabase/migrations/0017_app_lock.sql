-- App-level lock screen: a UI-level navigation gate, not a security boundary.
-- The device stays signed into the owner's real Supabase session the whole
-- time (staff never get their own auth.users row) - this just decides which
-- screens are reachable. One row per owner in a new app_settings table
-- (profiles already covers account/billing/business-profile concerns; this
-- is a distinct, PIN-only concept and doesn't need to grow that table).
--
-- Same hashing pattern as stylists.pin_hash (0013_stylist_pin.sql):
-- pgcrypto crypt()/gen_salt('bf'), written/compared only inside
-- security-definer functions, with the hash columns REVOKEd from
-- authenticated/anon so no ordinary select()/update() can read or
-- overwrite them. Deliberately no lockout counters here (unlike
-- verify_stylist_pin) - this PIN doesn't gate money movement, just nav.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.app_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  owner_pin_hash text,
  staff_pin_hash text,
  created_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

create policy "Users can view own app settings"
  on public.app_settings for select
  using (auth.uid() = user_id);

-- The only PIN-related thing client code should ever see. Generated so it
-- can never drift from the hash and can never be written directly.
alter table public.app_settings
  add column if not exists has_owner_pin boolean generated always as (owner_pin_hash is not null) stored,
  add column if not exists has_staff_pin boolean generated always as (staff_pin_hash is not null) stored;

revoke select (owner_pin_hash, staff_pin_hash),
  insert (owner_pin_hash, staff_pin_hash),
  update (owner_pin_hash, staff_pin_hash)
  on public.app_settings from authenticated, anon;

-- set_owner_pin / set_staff_pin: the only way either hash is ever written.
-- Both validate the 4-digit format (matches the stylist PIN convention)
-- and reject a PIN that collides with the *other* role's current PIN -
-- verify_app_pin below checks owner before staff, so an unnoticed
-- collision wouldn't error, it would just silently make the staff PIN
-- unreachable (it'd always resolve to 'owner'). Rejecting it at set-time
-- surfaces that immediately instead of shipping a confusing lock screen.
-- Upserts the row since app_settings has no auto-created row like profiles
-- does (a fresh owner has never set either PIN yet).
create or replace function public.set_owner_pin(p_pin text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_staff_hash text;
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;

  select staff_pin_hash into v_staff_hash
  from public.app_settings
  where user_id = auth.uid();

  if v_staff_hash is not null and v_staff_hash = extensions.crypt(p_pin, v_staff_hash) then
    raise exception 'PIN_CONFLICT';
  end if;

  insert into public.app_settings (user_id, owner_pin_hash)
  values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (user_id) do update
    set owner_pin_hash = excluded.owner_pin_hash;
end;
$$;

create or replace function public.set_staff_pin(p_pin text)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_owner_hash text;
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;

  select owner_pin_hash into v_owner_hash
  from public.app_settings
  where user_id = auth.uid();

  if v_owner_hash is not null and v_owner_hash = extensions.crypt(p_pin, v_owner_hash) then
    raise exception 'PIN_CONFLICT';
  end if;

  insert into public.app_settings (user_id, staff_pin_hash)
  values (auth.uid(), extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (user_id) do update
    set staff_pin_hash = excluded.staff_pin_hash;
end;
$$;

-- verify_app_pin: the only way either hash is ever compared against.
-- auth.uid() is still the owner's own session (staff never sign in
-- separately), so this just looks up that one row and reports which role,
-- if any, the PIN matched. No row yet (owner hasn't set a PIN) or no match
-- both return null rather than raising - the lock screen shows the same
-- inline "incorrect PIN" error either way, no separate error state needed.
create or replace function public.verify_app_pin(p_pin text)
returns text
language plpgsql
security definer set search_path = public, extensions
as $$
declare
  v_owner_hash text;
  v_staff_hash text;
begin
  select owner_pin_hash, staff_pin_hash
  into v_owner_hash, v_staff_hash
  from public.app_settings
  where user_id = auth.uid();

  if not found then
    return null;
  end if;

  if v_owner_hash is not null and v_owner_hash = extensions.crypt(p_pin, v_owner_hash) then
    return 'owner';
  end if;

  if v_staff_hash is not null and v_staff_hash = extensions.crypt(p_pin, v_staff_hash) then
    return 'staff';
  end if;

  return null;
end;
$$;
