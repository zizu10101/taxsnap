-- Rollback for 0074_receipt_import_batch.sql. NOT in supabase/migrations/ on purpose: that folder is
-- applied in order, and this must only ever be run by hand.
--
-- Drops the column and its index. The only data lost is which import each expense came from; every
-- expense, amount and receipt is untouched. After this the Expenses tab can no longer list or delete an
-- import as a group. Roll back the code first (or let it be: the import retries without the column, but
-- "Imports" and "Delete this import" will report that imports aren't available).

begin;

drop index if exists public.receipts_user_import_batch_idx;

alter table public.receipts
  drop column if exists import_batch_id;

commit;
