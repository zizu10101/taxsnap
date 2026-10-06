-- Rollback for 0053_statement_import_receipts.sql. Run this BEFORE the 0052
-- rollback. NOT in supabase/migrations/ on purpose: that folder is applied in
-- order, and this must only ever be run by hand.
--
-- Dropping receipts.from_statement / no_receipt erases which expenses were
-- created by a statement import, so the "No receipt, ITC not claimed" flag is
-- lost for good. The guard below refuses to run while any such expense exists.
-- To proceed anyway, either:
--   (a) delete those expenses (uncomment the DELETE below - it removes real
--       expense records), or
--   (b) accept losing the flag and remove the guard block.

begin;

do $$
declare
  n int;
begin
  select count(*) into n from public.receipts where from_statement;
  if n > 0 then
    raise exception
      'Refusing to roll back: % expense(s) were created by statement imports and would lose their "No receipt" flag. See the comments at the top of this file.', n;
  end if;
end;
$$;

-- delete from public.receipts where from_statement;   -- DESTRUCTIVE, see above

drop trigger if exists receipts_release_statement_lines on public.receipts;
drop function if exists public.release_statement_lines_on_receipt_delete();
drop index if exists public.receipts_awaiting_receipt_idx;
alter table public.receipts drop constraint if exists receipts_no_receipt_needs_statement;
alter table public.receipts
  drop column if exists receipt_attached_at,
  drop column if exists no_receipt,
  drop column if exists from_statement;

commit;
