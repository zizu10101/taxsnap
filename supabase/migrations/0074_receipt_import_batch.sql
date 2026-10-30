-- "Delete a whole import": remember which CSV import created an expense.
-- Rollback: supabase/rollbacks/0074_receipt_import_batch_rollback.sql
--
-- import_batch_id is a random id the expense CSV import generates once per import (POST
-- /api/receipts/import, apply) and writes on every expense that import creates. It lets the Expenses
-- tab list recent imports (date, rows, total) and delete exactly one import's expenses.
--
-- Deliberately:
--   * nullable, no default, no backfill - every expense saved before this, and every scanned, manual,
--     template or statement-created one, has no batch, and rows an earlier import made before this
--     existed simply can not be grouped;
--   * not a foreign key and not unique - the id names no table; many rows share one id;
--   * the code never trusts it: the delete route always filters by user_id as well, so a guessed or
--     copied id from another account matches nothing.
--
-- The index is partial (only imported rows, so it stays small) and leads with user_id: "this owner's
-- rows of batch X" and "this owner's recent batches" are both one index probe.
--
-- Grants / RLS: none to add. `receipts` has table-level privileges and row-level security that checks
-- only `auth.uid() = user_id` (see 0001_init.sql; no migration grants or revokes anything on
-- `receipts` per column), so a new column is covered by the existing policies. Nothing here touches
-- a policy, a trigger or a function.
--
-- Deploy order: apply this BEFORE the code ships. The import keeps working without it (it retries
-- without the column), but "Imports" has nothing to list until it is applied.

begin;

alter table public.receipts
  add column import_batch_id uuid;

create index receipts_user_import_batch_idx
  on public.receipts (user_id, import_batch_id)
  where import_batch_id is not null;

commit;
