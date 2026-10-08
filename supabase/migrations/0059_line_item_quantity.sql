-- Saved items remember a quantity as well as a price.
-- Rollback: supabase/rollbacks/0059_line_item_quantity_rollback.sql
--
-- Until now a saved item (line_items) stored only description + unit_price, so picking one on an
-- estimate or invoice always filled quantity = 1 and the owner retyped it. With this column, picking
-- a saved item fills description, quantity AND price.
--
-- Deliberately:
--   * NOT NULL DEFAULT 1 - every existing saved item keeps behaving exactly as it did (quantity 1),
--     and an insert that doesn't mention quantity (older code, a direct API call) still works;
--   * checked > 0 - a saved quantity of zero or less would produce a zero/negative line on pick;
--   * same numeric(12, 2) as document_items.quantity, so a picked value fits the line it fills.
-- Nothing here is a security boundary: row-level security on line_items already scopes every read
-- and write to the owner. document_items is untouched (it keeps snapshotting its own values).

begin;

alter table public.line_items
  add column if not exists quantity numeric(12, 2) not null default 1;

alter table public.line_items
  add constraint line_items_quantity_positive check (quantity > 0);

commit;
