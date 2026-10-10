-- Rollback for 0062_document_notes.sql. NOT in supabase/migrations/ on purpose: that folder is applied
-- in order, and this must only ever be run by hand.
--
-- Drops both columns, so every saved note (client-facing and internal) is lost. Roll the code back
-- FIRST: the new code writes and selects these columns and would fail without them.

begin;

alter table public.documents drop constraint if exists documents_notes_length;
alter table public.documents drop constraint if exists documents_internal_notes_length;
alter table public.documents drop column if exists notes;
alter table public.documents drop column if exists internal_notes;

commit;
