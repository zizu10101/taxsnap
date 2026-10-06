-- Rollback for 0056_receipt_file_hash.sql. NOT in supabase/migrations/ on purpose: that folder is
-- applied in order, and this must only ever be run by hand.
--
-- Removes the column and its index. The only data lost is the file hashes themselves (nothing else
-- references them), so every receipt, image and amount is untouched; scanning an old file again
-- simply stops warning that it was saved before. Safe to run at any time. The code that reads and
-- writes file_sha256 should be rolled back first (or it will error on the missing column).

begin;

drop index if exists public.receipts_user_file_sha256_idx;
alter table public.receipts drop column if exists file_sha256;  -- also drops its check constraint

commit;
