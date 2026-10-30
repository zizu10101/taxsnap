-- Rollback for 0073_receipt_invoice_number.sql.
-- Drops the column, which DELETES every invoice / receipt number the owners have entered or the
-- scanner read; nothing else depends on it. Deploy the code from before 0073 first, or its
-- writes of invoice_number will fail.

begin;

drop index if exists public.receipts_user_invoice_number_idx;

alter table public.receipts
  drop column if exists invoice_number;

commit;
