-- Two note fields on estimates and invoices.
-- Rollback: supabase/rollbacks/0062_document_notes_rollback.sql
--
--   notes           CLIENT-FACING. Printed after the totals on the PDF and shown on the public
--                   /sign and /invoice pages (and the portals' copy of the document).
--   internal_notes  OWNER-ONLY. Shown only on the owner's own detail page and edit form. It is never
--                   selected by a public page, a portal, an email or the PDF (a test scans for it).
--
-- Deliberately:
--   * Both are NULLABLE text with no default, and NOTHING IS BACKFILLED: every existing document
--     simply has no notes (null). The editor's old "Internal notes" box was never saved, so there is
--     nothing to recover.
--   * Blank is stored as null by the app (never ''), and a check keeps each field at 1-4000
--     characters when present.
-- Nothing here is a security boundary: row-level security already scopes documents to its owner, and
-- keeping internal_notes out of client-facing output is enforced in the app's explicit column lists.

begin;

alter table public.documents
  add column if not exists notes text,
  add column if not exists internal_notes text;

alter table public.documents
  add constraint documents_notes_length check (notes is null or char_length(notes) between 1 and 4000),
  add constraint documents_internal_notes_length check (internal_notes is null or char_length(internal_notes) between 1 and 4000);

commit;
