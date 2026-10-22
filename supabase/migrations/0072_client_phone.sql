-- Optional phone number on a client (internal contact info; never printed on an invoice, estimate, PDF,
-- public page, portal, email or export).
--
-- Run in the Supabase SQL Editor BEFORE the code that reads or writes clients.phone ships.
--
-- Safe on existing rows: the column is nullable with no default, so Postgres only changes the catalog (no table
-- rewrite, no backfill, existing rows read as NULL), and the CHECK is satisfied by NULL, so no row can violate it.
-- RLS is unchanged: the four policies on public.clients (0004) are row-level (auth.uid() = user_id) and there are
-- no column grants, column lists or triggers on clients, so the new column is covered by them automatically.

begin;

alter table public.clients
  add column if not exists phone text;

alter table public.clients
  add constraint clients_phone_length_check
    check (phone is null or char_length(phone) <= 40);

commit;

-- ROLLBACK (drops any phone numbers saved since; nothing else is affected):
--   begin;
--   alter table public.clients drop constraint if exists clients_phone_length_check;
--   alter table public.clients drop column if exists phone;
--   commit;
