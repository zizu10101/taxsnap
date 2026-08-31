-- Run this in the Supabase SQL Editor BEFORE deleting a user from
-- Authentication > Users. Not a schema migration - a one-off operational
-- script, parameterized per deletion, so it doesn't live under
-- supabase/migrations/.
--
-- Every table with a user_id column cascades cleanly from auth.users on its
-- own (profiles, receipts, documents, jobs, employees, stylists, services,
-- commission_entries, app_settings, etc.) and needs no help. Two tables
-- don't:
--
--   - payouts and adjustments have NO user_id column at all and nothing
--     ever cascades into them from auth.users - their only FK is
--     stylist_id -> stylists(id) ON DELETE RESTRICT. When the user delete
--     cascades down to stylists.user_id and tries to remove a stylist row,
--     Postgres checks that constraint and finds these rows still pointing
--     at it, and aborts the ENTIRE delete (the whole statement rolls back,
--     nothing partial happens - but nothing gets deleted either). This
--     fires every time a stylist has any payout or adjustment history,
--     which is the normal state for anyone who's actually used Commission.
--
--   - hour_entries.employee_id/job_id are also RESTRICT against
--     employees/jobs. hour_entries itself cascades from its own user_id,
--     so this *might* resolve on its own if Postgres happens to clear
--     hour_entries before cascading into employees/jobs - but the relative
--     order of independent cascade paths from a single delete isn't
--     documented or guaranteed, and none of these FKs are DEFERRABLE.
--     Deleting it explicitly here removes the ambiguity instead of hoping.
--
-- Replace the placeholder UUID below with the target user's actual
-- auth.users.id, then run this whole block. Once it completes, the user is
-- safe to delete from the dashboard - everything else will cascade or
-- SET NULL correctly on its own.

begin;

delete from public.adjustments
where stylist_id in (
  select id from public.stylists where user_id = '00000000-0000-0000-0000-000000000000'
);

delete from public.payouts
where stylist_id in (
  select id from public.stylists where user_id = '00000000-0000-0000-0000-000000000000'
);

delete from public.hour_entries
where user_id = '00000000-0000-0000-0000-000000000000';

commit;
