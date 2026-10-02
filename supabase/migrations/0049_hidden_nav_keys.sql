-- "Hide from my menu" (Settings -> Navigation): which feature tabs this owner
-- has chosen not to show in their own sidebar / bottom bar. Purely cosmetic -
-- nothing here affects tier access, API permissions or whether a page loads by
-- URL, and the records behind a hidden tab are untouched. The allowed values
-- (estimates, invoices, jobs, employees, clients, expenses, progress-billing,
-- overview, reports) are validated in the app (PATCH /api/profile/nav), not
-- here, so adding a hideable tab later needs no migration.
alter table public.profiles
  add column if not exists hidden_nav_keys text[] not null default '{}';
