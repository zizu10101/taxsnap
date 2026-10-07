-- Tax codes for expenses created from a card statement (phase (a) of the tax-codes scope).
-- Requires 0052-0056. Rollback: supabase/rollbacks/0057_tax_codes_rollback.sql
--
-- A statement expense used to be saved with tax_amount = 0 until a receipt was attached. It now
-- carries a CALCULATED tax: the tax embedded in the price (tax-included: total * rate / (1 + rate)),
-- computed from a "tax code" of three separate numbers:
--   tax_rate        how much tax is in the price (0.13 Ontario HST, or 0)
--   itc_pct         the share of that tax claimable as an input tax credit (1, 0.5, 0)
--   deductible_pct  the share of the expense that is deductible (1, 0.5)
-- (Meals is why there are three: 13% is still in the price, only half is claimable.)
--
-- ALL of these are nullable, and null means "no code": every existing row, every scanned receipt and
-- every manually typed expense keeps behaving exactly as it always did (Meals 50%, everything else
-- 100%, read from the category). A statement line with no applicable code is saved with tax 0 and
-- flagged "needs a tax code" in the app - nothing is ever guessed.
--
-- Where the numbers live:
--   statement_lines  the owner's choice for the line (tax_source 'line') while the import is a draft,
--                    and the resolved code once the import is saved (the app fills it in just before
--                    commit_statement_import runs)
--   receipts         the code the expense was saved with. Attaching a receipt clears it: the actual
--                    figure on the receipt replaces the calculated one (done by the attach route).
-- tax_source says where the code came from: 'line' (picked on the line), 'rule' (a vendor rule -
-- a later phase), 'foreign_currency', 'category' (a category default), 'kind' (fees and interest).
-- Bulk recategorize recomputes only rows whose source is 'category'.
--
-- No category defaults are stored: the only defaults (the bank charges category, fees and interest are
-- no-tax) are constants in the app, so there is no data to seed or to roll back.
--
-- This also REPLACES commit_statement_import() (0052): the original body, line for line, plus the four
-- new columns in the one insert into receipts. Its signature is unchanged, so `create or replace`
-- keeps the existing grants (service_role only).

begin;

-- ---------------------------------------------------------------------------
-- receipts
-- ---------------------------------------------------------------------------
alter table public.receipts
  add column tax_rate numeric(5, 4) check (tax_rate between 0 and 1),
  add column itc_pct numeric(5, 4) check (itc_pct between 0 and 1),
  add column deductible_pct numeric(5, 4) check (deductible_pct between 0 and 1),
  add column tax_source text
    check (tax_source in ('line', 'rule', 'foreign_currency', 'category', 'kind'));

-- All three numbers or none, and a source exactly when there is a code.
alter table public.receipts
  add constraint receipts_tax_code_all_or_none
    check (
      (tax_rate is null) = (itc_pct is null)
      and (tax_rate is null) = (deductible_pct is null)
      and (tax_rate is null) = (tax_source is null)
    ),
  -- Only a card-statement expense ever carries a code.
  add constraint receipts_tax_code_needs_statement
    check (tax_rate is null or from_statement);

-- ---------------------------------------------------------------------------
-- statement_lines
-- ---------------------------------------------------------------------------
alter table public.statement_lines
  add column tax_rate numeric(5, 4) check (tax_rate between 0 and 1),
  add column itc_pct numeric(5, 4) check (itc_pct between 0 and 1),
  add column deductible_pct numeric(5, 4) check (deductible_pct between 0 and 1),
  add column tax_source text
    check (tax_source in ('line', 'rule', 'foreign_currency', 'category', 'kind'));

alter table public.statement_lines
  add constraint statement_lines_tax_code_all_or_none
    check (
      (tax_rate is null) = (itc_pct is null)
      and (tax_rate is null) = (deductible_pct is null)
      and (tax_rate is null) = (tax_source is null)
    );

-- ---------------------------------------------------------------------------
-- commit_statement_import: the 0052 function, plus the code columns on the new expense
-- ---------------------------------------------------------------------------
-- Reads the decisions already saved on the lines. Errors: IMPORT_NOT_OPEN,
-- CHUNKS_INCOMPLETE, NOT_FINALIZED, RECONCILE_NOT_ACKNOWLEDGED, UNDECIDED_LINES,
-- UNCONFIRMED_CATEGORIES, DUPLICATE_LINES, BAD_RECEIPT_CLAIM. A unique
-- violation (23505) means a receipt already claimed by another line.
-- p_reconcile_diff: extracted total minus the statement's figure, or null when
-- the statement has none to check against.
-- Needs 0053 (receipts.from_statement / no_receipt) and this migration's columns.
create or replace function public.commit_statement_import(
  p_user_id uuid,
  p_import_id uuid,
  p_reconcile_diff numeric,
  p_reconcile_acknowledged boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import public.statement_imports%rowtype;
  v_line public.statement_lines%rowtype;
  v_receipt_id uuid;
  v_matched int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_skipped_duplicates int := 0;
begin
  -- Serialize this user's commits so two overlapping statements can't both pass
  -- the duplicate check and then both import the same charge.
  perform pg_advisory_xact_lock(hashtextextended('statement_commit:' || p_user_id::text, 0));

  select * into v_import from public.statement_imports
   where id = p_import_id and user_id = p_user_id for update;
  if not found or v_import.status <> 'draft' then
    raise exception 'IMPORT_NOT_OPEN';
  end if;
  if exists (select 1 from public.statement_chunks where import_id = p_import_id and status <> 'done') then
    raise exception 'CHUNKS_INCOMPLETE';
  end if;
  if exists (select 1 from public.statement_lines where import_id = p_import_id and line_fingerprint is null) then
    raise exception 'NOT_FINALIZED';
  end if;
  if p_reconcile_diff is not null and p_reconcile_diff <> 0 and not coalesce(p_reconcile_acknowledged, false) then
    raise exception 'RECONCILE_NOT_ACKNOWLEDGED';
  end if;
  if exists (select 1 from public.statement_lines where import_id = p_import_id and resolution is null) then
    raise exception 'UNDECIDED_LINES';
  end if;
  if exists (
    select 1 from public.statement_lines
     where import_id = p_import_id and resolution = 'new_expense'
       and (category is null or not category_confirmed)
  ) then
    raise exception 'UNCONFIRMED_CATEGORIES';
  end if;

  -- Re-check "already imported" now that we hold the lock: another statement
  -- may have been committed since this one was finalized (or an old expense
  -- deleted, which frees its line). Overridden lines keep their override.
  update public.statement_lines l
     set duplicate_of_line_id = (
           select d.id from public.statement_lines d
            where d.user_id = l.user_id and d.account_id = l.account_id
              and d.line_fingerprint = l.line_fingerprint
              and d.committed and d.resolution in ('matched', 'new_expense')
              and d.import_id <> l.import_id
            order by d.id limit 1
         )
   where l.import_id = p_import_id and not l.duplicate_override;

  if exists (
    select 1 from public.statement_lines
     where import_id = p_import_id and resolution in ('matched', 'new_expense')
       and duplicate_of_line_id is not null and not duplicate_override
  ) then
    raise exception 'DUPLICATE_LINES';
  end if;

  for v_line in
    select * from public.statement_lines
     where import_id = p_import_id order by page, line_no
  loop
    if v_line.resolution = 'matched' then
      -- The receipt must be this user's own, and still a real receipt.
      update public.receipts
         set paid_with_account_id = coalesce(paid_with_account_id, v_import.account_id)
       where id = v_line.matched_receipt_id and user_id = p_user_id and not no_receipt;
      if not found then
        raise exception 'BAD_RECEIPT_CLAIM';
      end if;
      v_matched := v_matched + 1;

    elsif v_line.resolution = 'new_expense' then
      insert into public.receipts (
        user_id, merchant_name, transaction_date, total_amount, tax_amount,
        tax_category, items, paid_with_account_id, from_statement, no_receipt,
        tax_rate, itc_pct, deductible_pct, tax_source
      ) values (
        p_user_id, left(trim(v_line.description), 200), v_line.txn_date, v_line.amount,
        v_line.tax_amount, v_line.category, '[]'::jsonb,
        coalesce(v_line.paid_with_account_id, v_import.account_id), true, true,
        v_line.tax_rate, v_line.itc_pct, v_line.deductible_pct, v_line.tax_source
      ) returning id into v_receipt_id;

      update public.statement_lines set created_receipt_id = v_receipt_id where id = v_line.id;
      v_created := v_created + 1;

    else
      v_skipped := v_skipped + 1;
      if v_line.duplicate_of_line_id is not null then
        v_skipped_duplicates := v_skipped_duplicates + 1;
      end if;
    end if;
  end loop;

  update public.statement_lines set committed = true where import_id = p_import_id;

  update public.statement_imports
     set status = 'committed', committed_at = now(), updated_at = now(),
         reconcile_diff = p_reconcile_diff,
         reconcile_acknowledged = coalesce(p_reconcile_acknowledged, false)
   where id = p_import_id;

  return jsonb_build_object(
    'matched', v_matched,
    'created', v_created,
    'skipped', v_skipped,
    'skipped_as_already_imported', v_skipped_duplicates
  );
end;
$$;

commit;
