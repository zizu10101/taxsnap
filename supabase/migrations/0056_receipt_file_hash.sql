-- Duplicate detection on receipt scanning: remember a fingerprint of the file that was scanned.
-- Rollback: supabase/rollbacks/0056_receipt_file_hash_rollback.sql
--
-- file_sha256 is the SHA-256 (64 lowercase hex characters) of the ORIGINAL file's bytes, computed
-- in the browser BEFORE the photo is compressed for upload. It is the only thing kept: never the
-- file's bytes. When a new scan's hash matches one of the same owner's receipts, the app warns
-- ("you already saved this file") before spending a Gemini call or a storage upload.
--
-- Deliberately:
--   * nullable - a manual expense, a template-logged one, and every receipt saved before this
--     existed have no hash, and there is NO backfill;
--   * NOT unique - saving a duplicate anyway must always be possible, so the same hash can appear
--     on more than one row;
--   * indexed per owner, partially (only rows that have a hash), so the lookup is one index probe
--     and the index stays small;
--   * checked to be well-formed hex, so a malformed value can't be stored.
-- Nothing here is a security boundary: it only drives a warning on the owner's own data, and the
-- existing row-level security on receipts already scopes every read and write to the owner.
--
-- Deleting a receipt deletes its hash with the row, so scanning the same file again afterwards
-- does not warn.

begin;

alter table public.receipts
  add column file_sha256 text
    constraint receipts_file_sha256_hex check (file_sha256 ~ '^[0-9a-f]{64}$');

create index receipts_user_file_sha256_idx
  on public.receipts (user_id, file_sha256)
  where file_sha256 is not null;

commit;
