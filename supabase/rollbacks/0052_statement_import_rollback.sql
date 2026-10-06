-- Rollback for 0052_statement_import.sql. Run the 0053 rollback FIRST (the
-- receipts trigger from 0053 reads statement_lines).
-- NOT in supabase/migrations/ on purpose: it must only ever be run by hand.
--
-- Drops all import history: drafts, committed imports, the record of which
-- statement line created or matched which expense, and the token-cost audit.
-- The expenses themselves are untouched (they are ordinary receipts rows).

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'receipts'
       and column_name = 'from_statement'
  ) then
    raise exception 'Run supabase/rollbacks/0053_statement_import_receipts_rollback.sql first.';
  end if;
end;
$$;

drop function if exists public.purge_stale_statement_drafts(int);
drop function if exists public.discard_statement_import(uuid, uuid);
drop function if exists public.commit_statement_import(uuid, uuid, numeric, boolean);
drop function if exists public.finalize_statement_lines(uuid, uuid);
drop function if exists public.fail_chunk(uuid, uuid, int, text, int, int);
drop function if exists public.save_chunk_result(uuid, uuid, int, jsonb, jsonb, int, int);
drop function if exists public.start_statement_import(uuid, uuid, text, int, jsonb, int);

-- Policies and indexes go with their tables.
drop table if exists public.statement_lines;
drop table if exists public.statement_chunks;
drop table if exists public.statement_imports;

commit;
