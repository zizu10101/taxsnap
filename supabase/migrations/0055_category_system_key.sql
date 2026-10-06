-- A stable identity for the one custom category statement import depends on.
-- Requires 0047 (expense_categories). Rollback: supabase/rollbacks/0055_*_rollback.sql
--
-- Statement import files interest and fees under a category it calls "Bank charges", and
-- until now it found that category BY ITS NAME. An owner can rename or remove a custom
-- category in Settings, so renaming it to "Bank fees" would make the next import create a
-- second "Bank charges", and removing it would make the next import bring it back.
--
-- system_key marks the row that plays that role, whatever the owner has since called it.
-- The import finds it by the key: a renamed one keeps being used under its new name, and a
-- removed (inactive) one is respected - nothing is suggested or recreated.
--
-- Nothing else changes: the owner can still rename and remove it freely, and it is an
-- ordinary custom category in every other respect (100% deductible, in reports, etc.).
-- Only 'bank_charges' exists today; the check constraint is the list of roles.

begin;

alter table public.expense_categories
  add column system_key text check (system_key in ('bank_charges'));

-- At most one category per owner plays each role.
create unique index expense_categories_system_key_idx
  on public.expense_categories (user_id, system_key) where system_key is not null;

-- Existing owners: the row the import already created (or that they made themselves with
-- that name) becomes the keyed one. Names are already unique per owner (case-insensitive),
-- so this can match at most one row each.
update public.expense_categories
   set system_key = 'bank_charges'
 where system_key is null
   and lower(btrim(name)) = 'bank charges';

commit;
