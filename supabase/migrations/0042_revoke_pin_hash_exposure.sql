-- SECURITY FIX: PIN hashes were readable by any signed-in user (their own rows).
--
-- 0013_stylist_pin.sql and 0017_app_lock.sql tried to hide pin_hash /
-- owner_pin_hash / staff_pin_hash with a COLUMN-level
-- `revoke select (col) ... from authenticated, anon`. In Postgres that is a
-- no-op while the role still holds a TABLE-level SELECT grant, and Supabase
-- grants table-level privileges to anon/authenticated by default. Verified
-- against the live project: an authenticated user could
--   select pin_hash from stylists;
--   select owner_pin_hash, staff_pin_hash from app_settings;
-- and a bare select("*") on stylists returned the bcrypt hash too. RLS only
-- stopped cross-user reads; a user could always read their OWN hashes.
-- That matters because staff-mode runs inside the owner's real session: anyone
-- holding the device could pull the owner PIN hash from the browser and brute
-- force the 4-digit space offline (10,000 candidates).
--
-- Fix: revoke at the TABLE level, then grant back only the non-secret columns.
-- Writes to the hash columns happen exclusively inside the security-definer
-- functions (set_stylist_pin, set_owner_pin, set_staff_pin, ...), which run as
-- the function owner and are unaffected.
--
-- Consequence worth knowing: because privileges are now per-column, a column
-- ADDED to either table later is invisible to the app until it is granted
-- here-style in the migration that adds it. Every app query on these tables
-- already uses an explicit column list (STYLIST_PUBLIC_COLUMNS /
-- APP_SETTINGS_PUBLIC_COLUMNS), so nothing in the app depends on select("*").

-- ---------------------------------------------------------------------------
-- stylists
-- ---------------------------------------------------------------------------
revoke select, insert, update on public.stylists from anon, authenticated;

grant select (
  id, user_id, name, is_active, pay_type, commission_rate,
  created_at, pin_failed_attempts, pin_locked_until, has_pin
) on public.stylists to authenticated;

-- has_pin is generated and pin_hash is function-only, so neither is writable.
-- pin_failed_attempts / pin_locked_until are only ever changed inside
-- verify_stylist_pin / set_stylist_pin, so they are not client-writable either
-- (a client resetting its own lockout counter would defeat the lockout).
grant insert (id, user_id, name, is_active, pay_type, commission_rate, created_at)
  on public.stylists to authenticated;
grant update (name, is_active, pay_type, commission_rate)
  on public.stylists to authenticated;

-- ---------------------------------------------------------------------------
-- app_settings
-- ---------------------------------------------------------------------------
-- Pure function-managed table (only a select RLS policy exists), so clients
-- only ever need to read the non-secret columns.
revoke select, insert, update on public.app_settings from anon, authenticated;

grant select (user_id, has_owner_pin, has_staff_pin, created_at)
  on public.app_settings to authenticated;
