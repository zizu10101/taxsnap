-- Rollback for 0059_line_item_quantity.sql. NOT in supabase/migrations/ on purpose: that folder is
-- applied in order, and this must only ever be run by hand.
--
-- Removes the quantity column (and its check constraint). The only data lost is the saved
-- quantities themselves; every saved item keeps its description and price, and no document or
-- document item is affected (they snapshot their own values). After this, picking a saved item
-- fills quantity 1 again. Roll the code back FIRST: saving a saved item sends the quantity, and would
-- fail on the missing column.

begin;

alter table public.line_items drop constraint if exists line_items_quantity_positive;
alter table public.line_items drop column if exists quantity;

commit;
