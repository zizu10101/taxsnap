-- Card statement import, part 1 of 2: the import tables and functions.
-- Part 2 (0053) adds the columns/trigger on `receipts`. Apply BOTH before any
-- code that calls commit_statement_import(), which writes those columns.
-- Rollback: supabase/rollbacks/ (0053's first, then this one's).
--
-- Extract lines from a card statement PDF/photo, review them, match them to
-- existing receipts, save the rest as "no receipt" expenses. The statement file
-- itself is never stored: the browser keeps it in memory and sends page chunks
-- for extraction; only the extracted lines, a SHA-256 of the file, and token
-- counts are kept.
--
-- Write model: owners can only SELECT these tables (RLS + table-level grants).
-- Every write goes through the API routes with the service-role client, using a
-- user id taken from the verified session (never the request body) - same
-- pattern as the employee/client portals. The functions are service_role-only.

begin;

-- ---------------------------------------------------------------------------
-- statement_imports: one row per import attempt
-- ---------------------------------------------------------------------------
create table public.statement_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- The card the statement belongs to. NO ACTION: accounts are deactivated,
  -- never deleted (see 0048), and a user deletion cascades in one statement.
  account_id uuid not null references public.bank_accounts (id),
  -- draft:     extraction/review in progress
  -- committed: saved as expenses (the only status that blocks a re-upload)
  -- discarded: abandoned by the user after at least one chunk was extracted
  -- expired:   a stale draft removed by the purge (lines deleted, row kept)
  -- failed:    nothing was ever extracted - does NOT count toward the monthly cap
  status text not null default 'draft'
    check (status in ('draft', 'committed', 'discarded', 'expired', 'failed')),
  file_sha256 text not null,
  page_count int not null check (page_count between 1 and 30),
  issuer text,
  period_start date,
  period_end date,
  opening_balance numeric(12, 2),
  closing_balance numeric(12, 2),
  -- The figure the extracted lines are checked against, when one is printed.
  statement_total numeric(12, 2),
  statement_total_kind text check (statement_total_kind in ('purchases', 'new_balance')),
  reconcile_diff numeric(12, 2),
  reconcile_acknowledged boolean not null default false,
  line_count int,
  -- Real cost, summed over every chunk attempt (retries included).
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  committed_at timestamptz
);

-- Monthly-cap lookups.
create index statement_imports_user_created_idx
  on public.statement_imports (user_id, created_at);
-- Stale-draft purge.
create index statement_imports_stale_draft_idx
  on public.statement_imports (updated_at) where status = 'draft';
-- The exact same file uploaded again after it was saved is refused up front
-- (ALREADY_IMPORTED). A re-exported copy with different bytes is NOT blocked
-- here: it is caught line by line (see statement_lines.duplicate_of_line_id),
-- where the user sees "Already imported" and can override.
create unique index statement_imports_committed_sha_idx
  on public.statement_imports (user_id, file_sha256) where status = 'committed';
-- One open draft per file: a double-click or a refresh resumes it instead of
-- starting (and billing) a second extraction.
create unique index statement_imports_open_draft_idx
  on public.statement_imports (user_id, file_sha256) where status = 'draft';

-- ---------------------------------------------------------------------------
-- statement_chunks: the unit of extraction and retry
-- ---------------------------------------------------------------------------
create table public.statement_chunks (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.statement_imports (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  chunk_no int not null,
  page_from int not null,
  page_to int not null,
  status text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts int not null default 0,
  error_code text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  unique (import_id, chunk_no),
  check (page_to >= page_from)
);

-- ---------------------------------------------------------------------------
-- statement_lines: extracted lines + the user's draft decisions
-- ---------------------------------------------------------------------------
create table public.statement_lines (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.statement_imports (id) on delete cascade,
  chunk_id uuid not null references public.statement_chunks (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  account_id uuid not null,
  page int not null,
  line_no int not null,
  txn_date date not null,
  description text not null,
  -- Signed as the card sees it: a charge is positive, a credit/refund negative.
  amount numeric(12, 2) not null,
  -- 'payment' = a payment TO the card (never an expense, skipped automatically).
  -- 'fee' and 'interest' go to the review list as Bank charges.
  kind text not null
    check (kind in ('purchase', 'payment', 'refund', 'fee', 'interest', 'other')),
  currency text not null default 'CAD',
  -- Foreign-currency lines: `amount` is the CAD posted amount; the original is
  -- informational only.
  original_amount numeric(12, 2),
  original_currency text,
  -- md5(account | date | amount | nth occurrence). Deliberately excludes the
  -- description: OCR wording can differ between two scans of the same
  -- statement, but date + amount do not. Null until every chunk is done
  -- (the occurrence number is only stable once all lines exist).
  line_fingerprint text,

  -- Duplicate guard. When a line's fingerprint matches a line that was already
  -- imported (committed, and still backed by an expense/match), finalize points
  -- duplicate_of_line_id at it and defaults the line to 'skipped'. The review
  -- screen shows these as "Already imported"; the user can choose "Import
  -- anyway", which sets duplicate_override. commit_statement_import() refuses
  -- (DUPLICATE_LINES) to import a flagged line that was not overridden.
  duplicate_of_line_id uuid references public.statement_lines (id) on delete set null,
  duplicate_override boolean not null default false,

  -- Category: the model's suggestion is prefilled but only counts once the user
  -- accepts it (or picks their own) - category_confirmed is the explicit action.
  suggested_category text,
  category text,
  category_confirmed boolean not null default false,
  -- null = the statement's card.
  paid_with_account_id uuid references public.bank_accounts (id),
  -- Refunds only (<= 0): the HST on the refund. 0 unless the user types the
  -- figure from the refund slip - never estimated.
  tax_amount numeric(12, 2) not null default 0,

  -- The user's decision (draft until `committed`).
  resolution text check (resolution in ('matched', 'new_expense', 'skipped')),
  matched_receipt_id uuid references public.receipts (id),
  created_receipt_id uuid references public.receipts (id),
  committed boolean not null default false,

  check (kind <> 'refund' or amount < 0),
  -- Only a positive purchase/other line can claim an existing receipt.
  check (resolution is distinct from 'matched' or (amount > 0 and kind in ('purchase', 'other'))),
  check (resolution is distinct from 'matched' or matched_receipt_id is not null),
  -- HST can't exceed the line, and shares its sign.
  check (
    (amount >= 0 and tax_amount between 0 and amount)
    or (amount < 0 and tax_amount between amount and 0)
  ),
  unique (import_id, page, line_no)
);

create index statement_lines_import_idx on public.statement_lines (import_id);
create index statement_lines_chunk_idx on public.statement_lines (chunk_id);

-- One-to-one: a receipt can be claimed by at most one line (drafts included, so
-- two lines in one review can't both take it).
create unique index statement_lines_matched_receipt_idx
  on public.statement_lines (matched_receipt_id) where matched_receipt_id is not null;
create unique index statement_lines_created_receipt_idx
  on public.statement_lines (created_receipt_id) where created_receipt_id is not null;
-- Lookup (NOT unique, so an override is possible) for "already imported".
create index statement_lines_imported_fingerprint_idx
  on public.statement_lines (user_id, account_id, line_fingerprint)
  where committed and resolution in ('matched', 'new_expense');

-- ---------------------------------------------------------------------------
-- RLS + table-level privileges: owners read, nobody but service_role writes
-- ---------------------------------------------------------------------------
alter table public.statement_imports enable row level security;
alter table public.statement_chunks enable row level security;
alter table public.statement_lines enable row level security;

create policy "Users can view own statement imports"
  on public.statement_imports for select using (auth.uid() = user_id);
create policy "Users can view own statement chunks"
  on public.statement_chunks for select using (auth.uid() = user_id);
create policy "Users can view own statement lines"
  on public.statement_lines for select using (auth.uid() = user_id);

-- Supabase's default privileges hand every new public table to anon and
-- authenticated; take everything back, then give owners SELECT only (RLS above
-- still limits it to their own rows). anon gets nothing at all.
revoke all on table
  public.statement_imports, public.statement_chunks, public.statement_lines
  from anon, authenticated;
grant select on table
  public.statement_imports, public.statement_chunks, public.statement_lines
  to authenticated;
grant all on table
  public.statement_imports, public.statement_chunks, public.statement_lines
  to service_role;

-- ---------------------------------------------------------------------------
-- start_statement_import: cap check + duplicate-file check + draft + chunk plan
-- ---------------------------------------------------------------------------
-- p_chunks: [{"page_from":1,"page_to":3}, ...]. p_monthly_cap null = no cap
-- (the cap per plan lives in app code, set after token costs are measured).
-- Errors: ACCOUNT_NOT_CARD, ALREADY_IMPORTED, STATEMENT_CAP_REACHED. A 23505
-- unique violation means an open draft for this file already exists - the
-- caller resumes it.
create function public.start_statement_import(
  p_user_id uuid,
  p_account_id uuid,
  p_file_sha256 text,
  p_page_count int,
  p_chunks jsonb,
  p_monthly_cap int
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_used int;
  v_month_start timestamptz;
begin
  -- Serialize this user's starts so two tabs can't both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended('statement_import:' || p_user_id::text, 0));

  if not exists (
    select 1 from public.bank_accounts
     where id = p_account_id and user_id = p_user_id and account_type = 'card'
  ) then
    raise exception 'ACCOUNT_NOT_CARD';
  end if;

  if exists (
    select 1 from public.statement_imports
     where user_id = p_user_id and file_sha256 = p_file_sha256 and status = 'committed'
  ) then
    raise exception 'ALREADY_IMPORTED';
  end if;

  if p_monthly_cap is not null then
    -- Calendar month in Toronto time. 'failed' (nothing extracted) is free;
    -- discarded/expired drafts still count because the extraction was paid for.
    v_month_start := date_trunc('month', now() at time zone 'America/Toronto')
                     at time zone 'America/Toronto';
    select count(*) into v_used
      from public.statement_imports
     where user_id = p_user_id and status <> 'failed' and created_at >= v_month_start;
    if v_used >= p_monthly_cap then
      raise exception 'STATEMENT_CAP_REACHED';
    end if;
  end if;

  insert into public.statement_imports (user_id, account_id, file_sha256, page_count)
  values (p_user_id, p_account_id, p_file_sha256, p_page_count)
  returning id into v_id;

  insert into public.statement_chunks (import_id, user_id, chunk_no, page_from, page_to)
  select v_id, p_user_id, c.n, (c.elem ->> 'page_from')::int, (c.elem ->> 'page_to')::int
    from jsonb_array_elements(p_chunks) with ordinality as c(elem, n);

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- save_chunk_result / fail_chunk: per-chunk results; a retry replaces only
-- that chunk's lines and never touches another chunk's
-- ---------------------------------------------------------------------------
-- p_lines: [{page,line_no,txn_date,description,amount,kind,currency,
--            original_amount,original_currency,suggested_category}]
-- (the caller numbers line_no sequentially within the page)
-- p_header (any chunk may carry it; the newest non-null value wins):
--   {issuer,period_start,period_end,opening_balance,closing_balance,
--    statement_total,statement_total_kind}
create function public.save_chunk_result(
  p_user_id uuid,
  p_import_id uuid,
  p_chunk_no int,
  p_lines jsonb,
  p_header jsonb,
  p_input_tokens int,
  p_output_tokens int
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import public.statement_imports%rowtype;
  v_chunk public.statement_chunks%rowtype;
  v_count int;
begin
  select * into v_import from public.statement_imports
   where id = p_import_id and user_id = p_user_id for update;
  if not found or v_import.status <> 'draft' then
    raise exception 'IMPORT_NOT_OPEN';
  end if;

  select * into v_chunk from public.statement_chunks
   where import_id = p_import_id and chunk_no = p_chunk_no for update;
  if not found then
    raise exception 'CHUNK_NOT_FOUND';
  end if;

  delete from public.statement_lines where chunk_id = v_chunk.id;

  insert into public.statement_lines (
    import_id, chunk_id, user_id, account_id, page, line_no, txn_date, description,
    amount, kind, currency, original_amount, original_currency, suggested_category
  )
  select p_import_id, v_chunk.id, p_user_id, v_import.account_id,
         l.page, l.line_no, l.txn_date, l.description, l.amount, l.kind,
         coalesce(l.currency, 'CAD'), l.original_amount, l.original_currency,
         l.suggested_category
    from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb)) as l(
      page int, line_no int, txn_date date, description text, amount numeric,
      kind text, currency text, original_amount numeric, original_currency text,
      suggested_category text
    );
  get diagnostics v_count = row_count;

  update public.statement_chunks
     set status = 'done', attempts = attempts + 1, error_code = null,
         input_tokens = input_tokens + coalesce(p_input_tokens, 0),
         output_tokens = output_tokens + coalesce(p_output_tokens, 0)
   where id = v_chunk.id;

  update public.statement_imports
     set issuer = coalesce(p_header ->> 'issuer', issuer),
         period_start = coalesce((p_header ->> 'period_start')::date, period_start),
         period_end = coalesce((p_header ->> 'period_end')::date, period_end),
         opening_balance = coalesce((p_header ->> 'opening_balance')::numeric, opening_balance),
         closing_balance = coalesce((p_header ->> 'closing_balance')::numeric, closing_balance),
         statement_total = coalesce((p_header ->> 'statement_total')::numeric, statement_total),
         statement_total_kind = coalesce(p_header ->> 'statement_total_kind', statement_total_kind),
         input_tokens = input_tokens + coalesce(p_input_tokens, 0),
         output_tokens = output_tokens + coalesce(p_output_tokens, 0),
         updated_at = now()
   where id = p_import_id;

  return v_count;
end;
$$;

create function public.fail_chunk(
  p_user_id uuid,
  p_import_id uuid,
  p_chunk_no int,
  p_error_code text,
  p_input_tokens int,
  p_output_tokens int
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.statement_chunks c
     set status = 'failed', attempts = attempts + 1, error_code = p_error_code,
         input_tokens = c.input_tokens + coalesce(p_input_tokens, 0),
         output_tokens = c.output_tokens + coalesce(p_output_tokens, 0)
   where c.import_id = p_import_id and c.user_id = p_user_id and c.chunk_no = p_chunk_no;

  update public.statement_imports
     set input_tokens = input_tokens + coalesce(p_input_tokens, 0),
         output_tokens = output_tokens + coalesce(p_output_tokens, 0),
         updated_at = now()
   where id = p_import_id and user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- finalize_statement_lines: once every chunk is done, fingerprint the lines and
-- flag the ones that were already imported
-- ---------------------------------------------------------------------------
create function public.finalize_statement_lines(
  p_user_id uuid,
  p_import_id uuid
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if not exists (
    select 1 from public.statement_imports
     where id = p_import_id and user_id = p_user_id and status = 'draft'
  ) then
    raise exception 'IMPORT_NOT_OPEN';
  end if;
  if exists (
    select 1 from public.statement_chunks
     where import_id = p_import_id and status <> 'done'
  ) then
    raise exception 'CHUNKS_INCOMPLETE';
  end if;

  update public.statement_lines l
     set line_fingerprint = md5(
           l.account_id::text || '|' || l.txn_date::text || '|' || l.amount::text || '|' || t.n::text
         )
    from (
      select id, row_number() over (
               partition by txn_date, amount order by page, line_no
             ) as n
        from public.statement_lines
       where import_id = p_import_id
    ) t
   where l.id = t.id;
  get diagnostics v_count = row_count;

  -- Flag lines already imported. They stay visible (the review screen shows
  -- "Already imported") and default to 'skipped' only if the user hasn't
  -- decided; they are never dropped.
  update public.statement_lines l
     set duplicate_of_line_id = (
           select d.id from public.statement_lines d
            where d.user_id = l.user_id and d.account_id = l.account_id
              and d.line_fingerprint = l.line_fingerprint
              and d.committed and d.resolution in ('matched', 'new_expense')
              and d.import_id <> l.import_id
            order by d.id limit 1
         )
   where l.import_id = p_import_id and not l.duplicate_override;

  update public.statement_lines
     set resolution = 'skipped'
   where import_id = p_import_id and resolution is null
     and (kind = 'payment' or duplicate_of_line_id is not null);

  update public.statement_imports
     set line_count = v_count, updated_at = now()
   where id = p_import_id;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- commit_statement_import: materialize the user's decisions in one transaction
-- ---------------------------------------------------------------------------
-- Reads the decisions already saved on the lines. Errors: IMPORT_NOT_OPEN,
-- CHUNKS_INCOMPLETE, NOT_FINALIZED, RECONCILE_NOT_ACKNOWLEDGED, UNDECIDED_LINES,
-- UNCONFIRMED_CATEGORIES, DUPLICATE_LINES, BAD_RECEIPT_CLAIM. A unique
-- violation (23505) means a receipt already claimed by another line.
-- p_reconcile_diff: extracted total minus the statement's figure, or null when
-- the statement has none to check against.
-- Needs 0053 (receipts.from_statement / no_receipt).
create function public.commit_statement_import(
  p_user_id uuid,
  p_import_id uuid,
  p_reconcile_diff numeric,
  p_reconcile_acknowledged boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import public.statement_imports%rowtype;
  v_line public.statement_lines%rowtype;
  v_receipt_id uuid;
  v_matched int := 0;
  v_created int := 0;
  v_skipped int := 0;
  v_skipped_duplicates int := 0;
begin
  -- Serialize this user's commits so two overlapping statements can't both pass
  -- the duplicate check and then both import the same charge.
  perform pg_advisory_xact_lock(hashtextextended('statement_commit:' || p_user_id::text, 0));

  select * into v_import from public.statement_imports
   where id = p_import_id and user_id = p_user_id for update;
  if not found or v_import.status <> 'draft' then
    raise exception 'IMPORT_NOT_OPEN';
  end if;
  if exists (select 1 from public.statement_chunks where import_id = p_import_id and status <> 'done') then
    raise exception 'CHUNKS_INCOMPLETE';
  end if;
  if exists (select 1 from public.statement_lines where import_id = p_import_id and line_fingerprint is null) then
    raise exception 'NOT_FINALIZED';
  end if;
  if p_reconcile_diff is not null and p_reconcile_diff <> 0 and not coalesce(p_reconcile_acknowledged, false) then
    raise exception 'RECONCILE_NOT_ACKNOWLEDGED';
  end if;
  if exists (select 1 from public.statement_lines where import_id = p_import_id and resolution is null) then
    raise exception 'UNDECIDED_LINES';
  end if;
  if exists (
    select 1 from public.statement_lines
     where import_id = p_import_id and resolution = 'new_expense'
       and (category is null or not category_confirmed)
  ) then
    raise exception 'UNCONFIRMED_CATEGORIES';
  end if;

  -- Re-check "already imported" now that we hold the lock: another statement
  -- may have been committed since this one was finalized (or an old expense
  -- deleted, which frees its line). Overridden lines keep their override.
  update public.statement_lines l
     set duplicate_of_line_id = (
           select d.id from public.statement_lines d
            where d.user_id = l.user_id and d.account_id = l.account_id
              and d.line_fingerprint = l.line_fingerprint
              and d.committed and d.resolution in ('matched', 'new_expense')
              and d.import_id <> l.import_id
            order by d.id limit 1
         )
   where l.import_id = p_import_id and not l.duplicate_override;

  if exists (
    select 1 from public.statement_lines
     where import_id = p_import_id and resolution in ('matched', 'new_expense')
       and duplicate_of_line_id is not null and not duplicate_override
  ) then
    raise exception 'DUPLICATE_LINES';
  end if;

  for v_line in
    select * from public.statement_lines
     where import_id = p_import_id order by page, line_no
  loop
    if v_line.resolution = 'matched' then
      -- The receipt must be this user's own, and still a real receipt.
      update public.receipts
         set paid_with_account_id = coalesce(paid_with_account_id, v_import.account_id)
       where id = v_line.matched_receipt_id and user_id = p_user_id and not no_receipt;
      if not found then
        raise exception 'BAD_RECEIPT_CLAIM';
      end if;
      v_matched := v_matched + 1;

    elsif v_line.resolution = 'new_expense' then
      insert into public.receipts (
        user_id, merchant_name, transaction_date, total_amount, tax_amount,
        tax_category, items, paid_with_account_id, from_statement, no_receipt
      ) values (
        p_user_id, left(trim(v_line.description), 200), v_line.txn_date, v_line.amount,
        v_line.tax_amount, v_line.category, '[]'::jsonb,
        coalesce(v_line.paid_with_account_id, v_import.account_id), true, true
      ) returning id into v_receipt_id;

      update public.statement_lines set created_receipt_id = v_receipt_id where id = v_line.id;
      v_created := v_created + 1;

    else
      v_skipped := v_skipped + 1;
      if v_line.duplicate_of_line_id is not null then
        v_skipped_duplicates := v_skipped_duplicates + 1;
      end if;
    end if;
  end loop;

  update public.statement_lines set committed = true where import_id = p_import_id;

  update public.statement_imports
     set status = 'committed', committed_at = now(), updated_at = now(),
         reconcile_diff = p_reconcile_diff,
         reconcile_acknowledged = coalesce(p_reconcile_acknowledged, false)
   where id = p_import_id;

  return jsonb_build_object(
    'matched', v_matched,
    'created', v_created,
    'skipped', v_skipped,
    'skipped_as_already_imported', v_skipped_duplicates
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- discard / purge
-- ---------------------------------------------------------------------------
create function public.discard_statement_import(
  p_user_id uuid,
  p_import_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.statement_imports
     where id = p_import_id and user_id = p_user_id and status = 'draft'
  ) then
    raise exception 'IMPORT_NOT_OPEN';
  end if;

  delete from public.statement_lines where import_id = p_import_id;

  update public.statement_imports
     set status = case
           when exists (select 1 from public.statement_chunks
                         where import_id = p_import_id and status = 'done')
           then 'discarded' else 'failed' end,
         updated_at = now()
   where id = p_import_id;
end;
$$;

-- Removes drafts untouched for p_days: their lines are deleted and the row is
-- reduced to a tombstone (tokens + status) so the monthly cap and the cost
-- audit still see the import. Returns how many drafts were purged.
create function public.purge_stale_statement_drafts(p_days int default 14)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with stale as (
    select i.id,
           exists (select 1 from public.statement_chunks c
                    where c.import_id = i.id and c.status = 'done') as had_results
      from public.statement_imports i
     where i.status = 'draft'
       and i.updated_at < now() - make_interval(days => p_days)
  ),
  del as (
    delete from public.statement_lines where import_id in (select id from stale)
  ),
  upd as (
    update public.statement_imports i
       set status = case when s.had_results then 'expired' else 'failed' end,
           issuer = null, period_start = null, period_end = null,
           opening_balance = null, closing_balance = null,
           statement_total = null, statement_total_kind = null,
           updated_at = now()
      from stale s
     where i.id = s.id
    returning i.id
  )
  select count(*) into v_count from upd;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function access: service_role only
-- ---------------------------------------------------------------------------
revoke all on function
  public.start_statement_import(uuid, uuid, text, int, jsonb, int),
  public.save_chunk_result(uuid, uuid, int, jsonb, jsonb, int, int),
  public.fail_chunk(uuid, uuid, int, text, int, int),
  public.finalize_statement_lines(uuid, uuid),
  public.commit_statement_import(uuid, uuid, numeric, boolean),
  public.discard_statement_import(uuid, uuid),
  public.purge_stale_statement_drafts(int)
from public, anon, authenticated;

grant execute on function
  public.start_statement_import(uuid, uuid, text, int, jsonb, int),
  public.save_chunk_result(uuid, uuid, int, jsonb, jsonb, int, int),
  public.fail_chunk(uuid, uuid, int, text, int, int),
  public.finalize_statement_lines(uuid, uuid),
  public.commit_statement_import(uuid, uuid, numeric, boolean),
  public.discard_statement_import(uuid, uuid),
  public.purge_stale_statement_drafts(int)
to service_role;

commit;
