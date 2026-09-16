-- Switches line_items from a total-row-count cap (no is_active, plain
-- DELETE) to the same active-row-cap/deactivate-only shape as services -
-- a management view is being added (ServiceList/ServiceDialog's own
-- pattern), and that needs a way to hide an item from future invoices
-- without losing it off historical document_items (which, like
-- commission_entries, already snapshots its own description/unit_price
-- at add time and never references line_items directly, so nothing
-- downstream actually required this - it's purely so "Deactivate" has
-- something to flip).
alter table public.line_items add column if not exists is_active boolean not null default true;
