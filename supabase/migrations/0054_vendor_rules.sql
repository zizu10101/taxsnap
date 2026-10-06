-- Vendor rules for card statement import: remember the category an owner chose for
-- a vendor, and prefill it on later statements ("From your rules").
-- Requires 0052 and 0053. Rollback: supabase/rollbacks/0054_vendor_rules_rollback.sql
--
-- What a rule can hold is a vendor, a category, an account and two counters. It has
-- NO tax column of any kind: HST is never stored on a rule and never applied by one.
--
-- Write model (same as the statement tables): owners can only SELECT vendor_rules;
-- every write is a service_role-only function, called from the API with the user id
-- of the verified session. The one exception is follow_category_rename() below,
-- which acts only on the CALLING user's own rows (auth.uid()).
--
-- This migration also REPLACES the existing rename_expense_category() (0047) so a
-- renamed custom category carries onto rules and open drafts. That function is
-- used by every user in Settings, so the replacement is the original, line for
-- line, plus one `perform` - see the comment on it.

begin;

-- ---------------------------------------------------------------------------
-- vendor_rules
-- ---------------------------------------------------------------------------
create table public.vendor_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The card the statement was for. NULL = the "any card" fallback, used on a card
  -- that has no rule of its own for this vendor. NO ACTION on delete, like every
  -- other reference to bank_accounts (accounts are deactivated, never deleted).
  account_id uuid references public.bank_accounts (id),
  -- Normalised cleaned vendor name (lib/merchant-name.ts vendorKey): lowercase,
  -- store numbers and punctuation removed. "HOME DEPOT #7042 TORONTO ON" and
  -- "HOME DEPOT #7013 MISSISSAUGA ON" share one key.
  vendor_key text not null check (vendor_key <> ''),
  vendor_label text not null,                         -- the cleaned name as shown: "Home Depot"
  -- A category NAME, not a foreign key (like receipts.tax_category). It is checked
  -- against the owner's current categories every time a rule is applied, so a
  -- deactivated or deleted custom category simply stops being suggested.
  category text not null check (btrim(category) <> ''),
  -- Only set when the owner paid with an account OTHER than the card; null means
  -- "the card the statement is for". Never set on an any-card rule (a paid-with
  -- account belongs to one card's context).
  paid_with_account_id uuid references public.bank_accounts (id),
  -- Reliability. A rule stops being prefilled once the owner has overridden it at
  -- least as often as they have confirmed it (times_overridden >= times_confirmed).
  times_confirmed int not null default 1 check (times_confirmed >= 1),
  times_overridden int not null default 0 check (times_overridden >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (account_id is not null or paid_with_account_id is null)
);

-- One rule per card per vendor, and one any-card rule per vendor (a plain unique
-- constraint would treat NULL account_ids as all-distinct).
create unique index vendor_rules_card_key_idx
  on public.vendor_rules (user_id, account_id, vendor_key) where account_id is not null;
create unique index vendor_rules_any_card_key_idx
  on public.vendor_rules (user_id, vendor_key) where account_id is null;
-- Looking a vendor up across both scopes.
create index vendor_rules_user_key_idx on public.vendor_rules (user_id, vendor_key);

alter table public.vendor_rules enable row level security;
create policy "Users can view own vendor rules"
  on public.vendor_rules for select using (auth.uid() = user_id);

revoke all on table public.vendor_rules from anon, authenticated;
grant select on table public.vendor_rules to authenticated;
grant all on table public.vendor_rules to service_role;

-- ---------------------------------------------------------------------------
-- statement_lines: where a prefilled category came from
-- ---------------------------------------------------------------------------
--   suggestion_source:       'rule'      - from a saved vendor rule ("From your rules")
--                            'statement' - from the owner's choice on another line of
--                                          THIS statement; nothing is stored until Save
--                            null        - the model's own suggestion (or none)
--   suggested_rule_id:       the rule behind a 'rule' suggestion, so "Forget this rule"
--                            knows which to delete.
--   model_suggested_category: the model's suggestion, kept when a rule or the statement
--                            replaces suggested_category, so forgetting a rule can put
--                            it back instead of losing it.
--   learn_rule:              the owner made this category choice deliberately (picked it
--                            or accepted it on that one line). Accept-all does NOT set
--                            it, so a bulk-accepted guess never becomes a standing rule.
--                            Rules are learned from these lines when the import is saved.
alter table public.statement_lines
  add column suggestion_source text check (suggestion_source in ('rule', 'statement')),
  add column suggested_rule_id uuid references public.vendor_rules (id) on delete set null,
  add column model_suggested_category text,
  add column learn_rule boolean not null default false;

alter table public.statement_lines
  add constraint statement_lines_rule_id_needs_rule_source
    check (suggested_rule_id is null or suggestion_source = 'rule');

-- ---------------------------------------------------------------------------
-- learn_vendor_rule: record one owner choice (service_role only)
-- ---------------------------------------------------------------------------
-- Called once per distinct (vendor, category) per saved statement - not once per
-- line - so twelve Shell lines in one statement count as one confirmation. It
-- writes the per-card rule AND the any-card fallback, both "last choice wins":
--   * same category as the stored rule -> times_confirmed + 1
--   * a different category            -> the rule takes the new category,
--                                         times_confirmed restarts at 1 and
--                                         times_overridden + 1 (so one override already
--                                         pauses the rule until it is confirmed again).
-- p_paid_with_account_id is kept only if it is a DIFFERENT account of this user's;
-- anything else (the card itself, someone else's account) is stored as null.
-- Returns false when nothing was stored (empty key/category, or the per-user
-- ceiling of 1,000 rules - about 500 vendors - was reached for a new vendor).
-- Errors: ACCOUNT_NOT_CARD.
create function public.learn_vendor_rule(
  p_user_id uuid,
  p_account_id uuid,
  p_vendor_key text,
  p_vendor_label text,
  p_category text,
  p_paid_with_account_id uuid
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid uuid := p_paid_with_account_id;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('vendor_rule:' || p_user_id::text, 0));

  if coalesce(btrim(p_vendor_key), '') = '' or coalesce(btrim(p_category), '') = '' then
    return false;
  end if;

  if not exists (
    select 1 from public.bank_accounts
     where id = p_account_id and user_id = p_user_id and account_type = 'card'
  ) then
    raise exception 'ACCOUNT_NOT_CARD';
  end if;

  if v_paid is not null and (
    v_paid = p_account_id
    or not exists (select 1 from public.bank_accounts where id = v_paid and user_id = p_user_id)
  ) then
    v_paid := null;
  end if;

  select count(*) into v_count from public.vendor_rules where user_id = p_user_id;
  if v_count >= 1000 and not exists (
    select 1 from public.vendor_rules where user_id = p_user_id and vendor_key = p_vendor_key
  ) then
    return false;
  end if;

  -- Per-card rule.
  insert into public.vendor_rules as r
    (user_id, account_id, vendor_key, vendor_label, category, paid_with_account_id)
  values
    (p_user_id, p_account_id, p_vendor_key, p_vendor_label, btrim(p_category), v_paid)
  on conflict (user_id, account_id, vendor_key) where account_id is not null
  do update set
    vendor_label = excluded.vendor_label,
    paid_with_account_id = excluded.paid_with_account_id,
    times_confirmed = case when lower(btrim(r.category)) = lower(btrim(excluded.category))
                           then r.times_confirmed + 1 else 1 end,
    times_overridden = case when lower(btrim(r.category)) = lower(btrim(excluded.category))
                            then r.times_overridden else r.times_overridden + 1 end,
    category = excluded.category,
    updated_at = now();

  -- Any-card fallback (never carries a paid-with account).
  insert into public.vendor_rules as r
    (user_id, account_id, vendor_key, vendor_label, category, paid_with_account_id)
  values
    (p_user_id, null, p_vendor_key, p_vendor_label, btrim(p_category), null)
  on conflict (user_id, vendor_key) where account_id is null
  do update set
    vendor_label = excluded.vendor_label,
    times_confirmed = case when lower(btrim(r.category)) = lower(btrim(excluded.category))
                           then r.times_confirmed + 1 else 1 end,
    times_overridden = case when lower(btrim(r.category)) = lower(btrim(excluded.category))
                            then r.times_overridden else r.times_overridden + 1 end,
    category = excluded.category,
    updated_at = now();

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- forget_vendor_rule: "Forget this rule" (service_role only)
-- ---------------------------------------------------------------------------
-- Deletes the vendor's rules in EVERY scope (the per-card ones and the any-card
-- fallback - leaving the fallback behind would make "forget" look like it hadn't
-- worked), and in the owner's open drafts puts the model's own suggestion back on
-- lines that were prefilled from those rules and not yet confirmed. A category the
-- owner already confirmed stands. Returns how many rules were deleted.
create function public.forget_vendor_rule(
  p_user_id uuid,
  p_vendor_key text
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
  v_deleted int;
begin
  select coalesce(array_agg(id), '{}') into v_ids
    from public.vendor_rules
   where user_id = p_user_id and vendor_key = p_vendor_key;

  update public.statement_lines
     set suggested_category = model_suggested_category,
         model_suggested_category = null,
         suggestion_source = null,
         suggested_rule_id = null
   where user_id = p_user_id
     and not committed
     and not category_confirmed
     and suggestion_source = 'rule'
     and suggested_rule_id = any (v_ids);

  delete from public.vendor_rules where id = any (v_ids);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ---------------------------------------------------------------------------
-- A renamed custom category must follow onto rules and open drafts
-- ---------------------------------------------------------------------------
-- rename_expense_category() is SECURITY INVOKER (RLS scopes it to the caller), and
-- an owner has no UPDATE right on vendor_rules or statement_lines - so it cannot
-- touch them itself, and giving it a direct write would make EVERY rename fail with
-- "permission denied". This helper does the follow-on writes instead. It is
-- SECURITY DEFINER but acts only on auth.uid()'s own rows, so it is safe to expose
-- to signed-in users; called by anyone else (no session) it does nothing.
--   * vendor_rules.category                      - the rule keeps working under the new name
--   * statement_lines (open drafts only) category / suggested_category /
--     model_suggested_category                   - a draft saved after the rename would
--                                                  otherwise create expenses under the
--                                                  old, now-unknown name
-- Committed lines are history and are left alone.
create function public.follow_category_rename(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old text := lower(btrim(p_old));
  v_new text := btrim(p_new);
begin
  if v_uid is null or v_old = '' or v_new = '' then
    return;
  end if;

  update public.vendor_rules
     set category = v_new, updated_at = now()
   where user_id = v_uid and lower(btrim(category)) = v_old;

  update public.statement_lines set category = v_new
   where user_id = v_uid and not committed and lower(btrim(category)) = v_old;
  update public.statement_lines set suggested_category = v_new
   where user_id = v_uid and not committed and lower(btrim(suggested_category)) = v_old;
  update public.statement_lines set model_suggested_category = v_new
   where user_id = v_uid and not committed and lower(btrim(model_suggested_category)) = v_old;
end;
$$;

-- The original (0047) body, unchanged, plus ONE added line:
--     perform public.follow_category_rename(v_old, v_new);
-- Existing grants on the function are preserved by `create or replace`.
create or replace function public.rename_expense_category(p_id uuid, p_new_name text)
returns public.expense_categories
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text;
  v_new text := btrim(p_new_name);
  v_row public.expense_categories;
begin
  select name into v_old from public.expense_categories where id = p_id and user_id = auth.uid();
  if v_old is null then
    raise exception 'CATEGORY_NOT_FOUND';
  end if;

  update public.expense_categories set name = v_new
    where id = p_id and user_id = auth.uid()
    returning * into v_row;

  update public.receipts set tax_category = v_new
    where user_id = auth.uid() and lower(btrim(tax_category)) = lower(btrim(v_old));
  update public.expense_templates set default_tax_category = v_new
    where user_id = auth.uid() and lower(btrim(default_tax_category)) = lower(btrim(v_old));

  perform public.follow_category_rename(v_old, v_new);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function access
-- ---------------------------------------------------------------------------
revoke all on function
  public.learn_vendor_rule(uuid, uuid, text, text, text, uuid),
  public.forget_vendor_rule(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.learn_vendor_rule(uuid, uuid, text, text, text, uuid),
  public.forget_vendor_rule(uuid, text)
to service_role;

-- Signed-in users call this indirectly through rename_expense_category (which runs
-- as them), so authenticated needs EXECUTE on it. anon does not.
revoke all on function public.follow_category_rename(text, text) from public, anon;
grant execute on function public.follow_category_rename(text, text) to authenticated, service_role;

commit;
