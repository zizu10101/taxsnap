-- Rollback for 0054_vendor_rules.sql. NOT in supabase/migrations/ on purpose: that
-- folder is applied in order, and this must only ever be run by hand.
--
-- What this removes: every saved vendor rule (a rule is derived convenience data -
-- the owner's categories and every saved expense are untouched, and rules are
-- simply re-learned from the next statements), and the four columns on
-- statement_lines that record where a prefilled category came from. Existing
-- statement lines keep their category, suggested_category and decisions.
--
-- It also puts rename_expense_category() back to its exact 0047 definition. That
-- MUST happen before follow_category_rename() is dropped, because the 0054 version
-- of rename_expense_category() calls it - dropping it first would break every
-- category rename in Settings.

begin;

-- 1. The original (0047) rename_expense_category, verbatim.
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

  return v_row;
end;
$$;

-- 2. Nothing calls these any more.
drop function if exists public.follow_category_rename(text, text);
drop function if exists public.forget_vendor_rule(uuid, text);
drop function if exists public.learn_vendor_rule(uuid, uuid, text, text, text, uuid);

-- 3. Columns on statement_lines (the constraint and the foreign key go first).
alter table public.statement_lines
  drop constraint if exists statement_lines_rule_id_needs_rule_source;
alter table public.statement_lines
  drop column if exists learn_rule,
  drop column if exists model_suggested_category,
  drop column if exists suggested_rule_id,
  drop column if exists suggestion_source;

-- 4. The table (its policy and indexes go with it).
drop table if exists public.vendor_rules;

commit;
