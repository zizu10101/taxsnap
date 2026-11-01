-- Statement import from a CSV file: starting an import for ANY of the owner's active accounts.
-- Apply BEFORE the code that calls start_statement_csv_import() ships.
-- Rollback: supabase/rollbacks/0075_statement_csv_import_rollback.sql
--
-- A CSV needs no model call, so there are no pages to read: the server creates the draft with ONE
-- chunk (page 1) and saves every line into it in the same request, then runs the same
-- finalize_statement_lines() (fingerprints + "already imported" flags) the PDF path uses.
-- start_statement_import() (0052) is left exactly as it is: it only accepts a credit card, and the
-- PDF/photo path keeps depending on that. A CSV may belong to a bank account too, so it gets its
-- own starter. Differences from the PDF starter, and nothing else:
--   * the account may be a bank account or a card, but must be the user's own and active
--   * no monthly cap check (nothing is spent reading a CSV); the import still counts toward the
--     month's tally of imports, like any other row in statement_imports
--   * exactly one chunk, page 1
-- Errors: ACCOUNT_NOT_FOUND, ALREADY_IMPORTED. A 23505 means an open draft for this file already
-- exists (the caller replaces that draft's lines).

begin;

create function public.start_statement_csv_import(
  p_user_id uuid,
  p_account_id uuid,
  p_file_sha256 text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('statement_import:' || p_user_id::text, 0));

  if not exists (
    select 1 from public.bank_accounts
     where id = p_account_id and user_id = p_user_id and is_active
  ) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.statement_imports
     where user_id = p_user_id and file_sha256 = p_file_sha256 and status = 'committed'
  ) then
    raise exception 'ALREADY_IMPORTED';
  end if;

  insert into public.statement_imports (user_id, account_id, file_sha256, page_count)
  values (p_user_id, p_account_id, p_file_sha256, 1)
  returning id into v_id;

  insert into public.statement_chunks (import_id, user_id, chunk_no, page_from, page_to)
  values (v_id, p_user_id, 1, 1, 1);

  return v_id;
end;
$$;

revoke all on function public.start_statement_csv_import(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.start_statement_csv_import(uuid, uuid, text) to service_role;

commit;
