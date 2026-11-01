-- Rollback for 0075_statement_csv_import.sql.
-- NOT in supabase/migrations/ on purpose: it must only ever be run by hand.
--
-- Drops the CSV starter only. Imports already created through it are ordinary statement_imports
-- rows and are left alone (the review, commit and delete functions work on them as before).
-- Deploy the code that no longer calls start_statement_csv_import() first.

begin;

drop function if exists public.start_statement_csv_import(uuid, uuid, text);

commit;
