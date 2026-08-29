-- Stylists don't have accounts, so payout confirmation uses a simple local
-- 4-digit PIN instead of a real auth flow - the owner sets it once per
-- stylist, in person, then hands the device to the stylist at confirm time.
--
-- Hashed with pgcrypto's crypt()/gen_salt('bf') (bcrypt) inside two
-- security-definer functions, same pattern as create_payout/confirm_payout -
-- the raw PIN and the hash comparison never leave the database. Those
-- functions run as their owning role, so the column-level REVOKEs below
-- (which target the `authenticated`/`anon` roles used by ordinary
-- PostgREST requests) don't affect what the functions themselves can
-- read/write internally.
create extension if not exists pgcrypto with schema extensions;
alter table public.stylists
  add column if not exists pin_hash text;
-- The only PIN-related thing client code should ever see. Generated, so it
-- can never drift from pin_hash and can never be written directly either.
alter table public.stylists
  add column if not exists has_pin boolean generated always as (pin_hash is not null) stored;
-- pin_hash must never be selectable (or writable outside the functions
-- below) via a normal authenticated request, no matter what a .select()/
-- .update() call asks for - enforced at the column level so a stray
-- "select *" or a raw client-side update can't leak or overwrite it, not
-- just a convention every call site has to remember correctly.
revoke select (pin_hash), insert (pin_hash), update (pin_hash)
  on public.stylists from authenticated, anon;

-- Lockout state for verify_stylist_pin. Tracked separately from pin_hash
-- (no REVOKE needed on these two - they carry no secret, just attempt state)
-- so the app can also surface "locked" in the UI if it wants to.
alter table public.stylists
  add column if not exists pin_failed_attempts int not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- set_stylist_pin: the only way pin_hash is ever written. Validates the
-- 4-digit format server-side (defense in depth - the UI enforces this too),
-- hashes before storing, and clears any existing lockout - an owner
-- resetting a stylist's PIN (e.g. because they forgot it) should also
-- unstick them if they were locked out on the old one.
create or replace function public.set_stylist_pin(
  p_stylist_id uuid,
  p_pin text
)
returns void
language plpgsql
security definer set search_path = public, extensions
as $$
begin
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'INVALID_PIN';
  end if;
  update public.stylists
  set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')),
      pin_failed_attempts = 0,
      pin_locked_until = null
  where id = p_stylist_id and user_id = auth.uid();
  if not found then
    raise exception 'STYLIST_NOT_FOUND';
  end if;
end;
$$;

-- verify_stylist_pin: the only way pin_hash is ever compared against.
-- Checks the lock before comparing anything. A correct guess resets the
-- counter; a wrong guess increments it and, on the 5th consecutive miss,
-- locks for 15 minutes. Lock check and increment happen in the same
-- function invocation as the compare, so there's no separate round-trip
-- where a caller could race two verify attempts in and slip past the
-- threshold. Returns false (not an error) when no PIN is set, rather than
-- raising - callers are expected to already know a stylist's has_pin
-- status (it's selectable, unlike pin_hash) before ever showing a PIN
-- input, so this is just a safe fallback, not the primary way the
-- "no PIN set" state gets surfaced.
create or replace function public.verify_stylist_pin(
  p_stylist_id uuid,
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
  select pin_hash, pin_locked_until, pin_failed_attempts
  into v_hash, v_locked_until, v_attempts
  from public.stylists
  where id = p_stylist_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'STYLIST_NOT_FOUND';
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    raise exception 'PIN_LOCKED';
  end if;

  if v_hash is null then
    return false;
  end if;

  v_match := (v_hash = extensions.crypt(p_pin, v_hash));

  if v_match then
    update public.stylists
    set pin_failed_attempts = 0, pin_locked_until = null
    where id = p_stylist_id;
  else
    v_attempts := v_attempts + 1;
    update public.stylists
    set pin_failed_attempts = v_attempts,
        pin_locked_until = case when v_attempts >= 5
          then now() + interval '15 minutes'
          else null
        end
    where id = p_stylist_id;
  end if;

  return v_match;
end;
$$;