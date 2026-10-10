-- A line gets a short NAME (shown bold), an optional longer DESCRIPTION, and an optional UNIT of measure.
-- Rollback: supabase/rollbacks/0061_line_name_description_unit_rollback.sql
--
-- Applies to document_items (estimate / invoice lines) and line_items (the owner's saved items).
--
-- Deliberately:
--   * `name` is NULLABLE and there is NO backfill. A row whose name is null is a line from before this
--     migration: its old `description` IS its name, with an empty description. The app reads it that
--     way (lib/line-format.ts lineName / lineDescription), so every existing document renders as it did
--     and nothing is rewritten. New and re-saved lines always store a name.
--   * `description` keeps its NOT NULL (an empty string means "no description"), so older code that
--     inserts only a description still works.
--   * `unit` is NULLABLE; null/blank = no unit, which looks exactly like today. Free text so "other"
--     needs no list to maintain; the presets (each, hr, day, sq ft, linear ft, m, yd) are an app concern.
--   * unit is checked to be 1-20 characters when present, and name 1-200.
-- Nothing here is a security boundary: row-level security already scopes both tables to the owner.

begin;

alter table public.document_items
  add column if not exists name text,
  add column if not exists unit text;

alter table public.document_items
  add constraint document_items_name_length check (name is null or char_length(btrim(name)) between 1 and 200),
  add constraint document_items_unit_length check (unit is null or char_length(btrim(unit)) between 1 and 20);

alter table public.line_items
  add column if not exists name text,
  add column if not exists unit text;

alter table public.line_items
  add constraint line_items_name_length check (name is null or char_length(btrim(name)) between 1 and 200),
  add constraint line_items_unit_length check (unit is null or char_length(btrim(unit)) between 1 and 20);

commit;
