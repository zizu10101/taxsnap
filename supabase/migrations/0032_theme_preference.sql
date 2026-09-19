-- Light/dark/system theme preference, account-level so it survives
-- across devices/sessions (not just localStorage on one browser).
-- Defaults to 'light' - the app's current appearance - for every
-- existing and new account, so this ships with zero visual change until
-- someone opts in via Settings.
alter table public.profiles
  add column if not exists theme_preference text not null default 'light'
  check (theme_preference in ('light', 'dark', 'system'));
