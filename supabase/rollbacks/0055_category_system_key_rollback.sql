-- Rollback for 0055_category_system_key.sql. NOT in supabase/migrations/ on purpose: that
-- folder is applied in order, and this must only ever be run by hand.
--
-- Removes the stable key. Every category keeps its name and its expenses; the only loss
-- is the "this is the Bank charges one" marker, so a category that was renamed after being
-- keyed (say to "Bank fees") is no longer recognised as the import's category. The code
-- then falls back to looking for the NAME "Bank charges", as before 0055.

begin;

drop index if exists public.expense_categories_system_key_idx;
alter table public.expense_categories drop column if exists system_key;

commit;
