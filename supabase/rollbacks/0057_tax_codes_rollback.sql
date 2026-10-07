-- Rollback for 0057_tax_codes.sql. NOT in supabase/migrations/ on purpose: that folder is
-- applied in order, and this must only ever be run by hand.
--
-- Restores the old rule for statement expenses: no receipt means tax 0 and no ITC.
--
--   1. Statement PURCHASES that are still waiting for a receipt and were given a calculated tax by
--      this feature (a tax code on the row) go back to tax_amount = 0. Without this their calculated
--      tax would stay behind as an ordinary-looking figure and keep counting toward ITC after the
--      columns that explain it are gone. Rows with a receipt attached keep their actual tax (that
--      figure came from the receipt). Refunds are left alone: a refund's HST may have been typed by
--      the owner from the slip, and that figure can't be told apart from a calculated one.
--   2. commit_statement_import() goes back to the exact 0052 body (no code columns).
--   3. The columns and their constraints are dropped. What is lost: the tax codes themselves and the
--      choices made on statement lines. No expense, receipt or amount is deleted.
--
-- Run this only while no statement import is mid-commit.

begin;

update public.receipts
   set tax_amount = 0
 where from_statement and no_receipt and tax_rate is not null and total_amount > 0;

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
        tax_category, items, paid_with_account_id, from_statement, no_receipt
      ) values (
        p_user_id, left(trim(v_line.description), 200), v_line.txn_date, v_line.amount,
        v_line.tax_amount, v_line.category, '[]'::jsonb,
        coalesce(v_line.paid_with_account_id, v_import.account_id), true, true
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

alter table public.receipts
  drop constraint if exists receipts_tax_code_needs_statement,
  drop constraint if exists receipts_tax_code_all_or_none,
  drop column if exists tax_source,
  drop column if exists deductible_pct,
  drop column if exists itc_pct,
  drop column if exists tax_rate;

alter table public.statement_lines
  drop constraint if exists statement_lines_tax_code_all_or_none,
  drop column if exists tax_source,
  drop column if exists deductible_pct,
  drop column if exists itc_pct,
  drop column if exists tax_rate;

commit;
