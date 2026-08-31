-- Google OAuth signup has no equivalent moment to the password sign-up
-- form's business_type selector - signInWithOAuth() has no options.data to
-- carry an answer through, so every Google-authenticated account silently
-- landed on the column default ('general') regardless of what kind of
-- business it actually is.
--
-- needs_business_type_prompt tracks "has this account been asked yet" as
-- its own explicit flag, deliberately not inferred from business_type
-- still being 'general' (that's also true for anyone who legitimately
-- chose General Business on the password form, or any long-time general
-- account, so it can't distinguish "never asked" from "asked and
-- answered general") and not inferred from onboarding_completed (that
-- only ever gets set for a 'salon' account - it stays false forever for
-- every general account regardless of how long they've been using the
-- app, so it's equally unusable as a "never asked" signal here).
--
-- Existing accounts explicitly should not be retroactively prompted - the
-- column default (false) already covers that with no separate backfill
-- needed, since it only ever gets set true below for a brand-new insert
-- through the *new* version of this trigger, never applied to a row that
-- already exists.
alter table public.profiles
  add column if not exists needs_business_type_prompt boolean not null default false;

-- raw_app_meta_data.provider is Supabase Auth's own record of which
-- provider created this identity ('google' for OAuth, 'email' for
-- password/magic-link/signup-confirm) - a real signal already set by
-- GoTrue itself, not something this app has to infer or maintain.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, business_type, needs_business_type_prompt)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_type', 'general'),
    (new.raw_app_meta_data ->> 'provider') = 'google'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
