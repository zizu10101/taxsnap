-- profiles.business_type already existed (0001_init.sql) as a free-text
-- column defaulted to 'General Trade' - a leftover from the app's original
-- trade-contractor-only framing that was never actually wired into any app
-- code (no reads or writes anywhere). Repurposing it now as the real
-- two-value switch that gates the Commission nav tab, rather than adding a
-- differently-named column and leaving this one dead.
--
-- Backfill is data-driven, not a blanket default: an existing account gets
-- 'salon' if it already has stylists or commission_entries (Commission is
-- genuinely in use), 'general' otherwise. This is what correctly makes an
-- account with real Commission activity come out as 'salon' without having
-- to special-case any specific user id.
update public.profiles p
set business_type = 'salon'
where exists (
  select 1 from public.stylists s where s.user_id = p.id
) or exists (
  select 1 from public.commission_entries c where c.user_id = p.id
);

update public.profiles
set business_type = 'general'
where business_type not in ('salon', 'general');

alter table public.profiles
  alter column business_type set default 'general';

alter table public.profiles
  add constraint profiles_business_type_check
  check (business_type in ('salon', 'general'));

-- handle_new_user() now reads business_type from the signup call's
-- options.data (auth.users.raw_user_meta_data) when present - the password
-- sign-up form's two-option choice passes it this way (see AuthForm) - and
-- falls back to the column default ('general') otherwise, which covers
-- magic-link and Google OAuth signups that have no such metadata (no
-- onboarding flow exists yet to ask them; that's separate follow-up work).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, business_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'business_type', 'general')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
