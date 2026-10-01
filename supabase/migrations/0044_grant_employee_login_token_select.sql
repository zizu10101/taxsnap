-- 0043 added app_settings.employee_login_token and (in its current text) the
-- grant below, but the live database was found to be missing it: after
-- 0042's table-level revoke, the owner's Settings page could not read the
-- token (42501 permission denied), so it showed "Create sign-in link" even
-- when a link already existed. Idempotent - safe to run even if 0043's own
-- grant did apply.
grant select (employee_login_token) on public.app_settings to authenticated;
