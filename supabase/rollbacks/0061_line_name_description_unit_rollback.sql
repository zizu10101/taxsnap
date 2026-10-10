-- Rollback for 0061_line_name_description_unit.sql. NOT in supabase/migrations/ on purpose: that folder
-- is applied in order, and this must only ever be run by hand.
--
-- Before dropping `name`, fold it back into `description` so no text is lost: a line with a name and a
-- description becomes "name - description", a line with only a name becomes that name. Units are
-- dropped (the old schema has nowhere to keep them). Roll the code back FIRST: the new code sends
-- name/unit and would fail on the missing columns.

begin;

update public.document_items
   set description = case when btrim(description) = '' then name else name || ' - ' || description end
 where name is not null;

update public.line_items
   set description = case when btrim(description) = '' then name else name || ' - ' || description end
 where name is not null;

alter table public.document_items drop constraint if exists document_items_name_length;
alter table public.document_items drop constraint if exists document_items_unit_length;
alter table public.document_items drop column if exists name;
alter table public.document_items drop column if exists unit;

alter table public.line_items drop constraint if exists line_items_name_length;
alter table public.line_items drop constraint if exists line_items_unit_length;
alter table public.line_items drop column if exists name;
alter table public.line_items drop column if exists unit;

commit;
