-- "Invoice / receipt number" on an expense: the number printed on the document (a supplier's
-- invoice number, a till receipt number), read by the scanner and editable by the owner.
-- Rollback: supabase/rollbacks/0073_receipt_invoice_number_rollback.sql
--
-- It exists for one reason: a strong duplicate warning. Saving a second expense whose invoice
-- number AND merchant match an expense that is already saved warns the owner, even if the total
-- or the date differs (a corrected invoice, a re-issued copy). A WARNING only: nothing is blocked.
--
-- Deliberately:
--   * nullable, no default, no backfill - every receipt saved before this has no number, and a
--     manual expense, a template-logged one and a statement-created one usually won't either;
--   * NOT unique - saving a duplicate anyway must always be possible, and two suppliers can print
--     the same number;
--   * no length check here: the 40-character cap (and trimming, and stripping control characters)
--     is applied in the API (lib/invoice-number.ts), the one place every write goes through;
--   * stored as printed ("INV-0042"); the comparison key (upper case, letters and digits only,
--     leading zeros dropped) is computed in code, so it is never stored and can't drift.
--
-- The index is partial (only rows that have a number, so it stays small) and leads with user_id.
-- The lookup narrows to the owner's numbered expenses with it, pre-filters with a pattern, then
-- compares the normalised number and the cleaned merchant in code. The cleaned merchant
-- (merchant-name.ts vendorKey) is application code and can not be written as an index expression,
-- so merchant is not an index column.
--
-- Grants / RLS: none to add. `receipts` has table-level privileges and row-level security that
-- checks only `auth.uid() = user_id` (no column-level GRANT/REVOKE exists on this table), so a new
-- column is covered by the existing policies. Nothing here touches a policy or a function.

begin;

alter table public.receipts
  add column invoice_number text;

create index receipts_user_invoice_number_idx
  on public.receipts (user_id, invoice_number)
  where invoice_number is not null;

commit;
