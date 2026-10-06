-- Card statement import, part 2 of 2: changes to the existing `receipts` table.
-- Requires 0052. Kept separate so the new import tables can be applied (and
-- rolled back) without touching `receipts`, and so the `receipts` change can be
-- reviewed and reverted on its own: supabase/rollbacks/0053_*.
--
-- No refund link column: a refund is just an expense row with a negative total.

begin;

-- A boolean rather than a 'scan'/'manual'/'card_statement' enum: existing rows
-- can't be truthfully back-filled into scan vs manual, so only the new
-- distinction is recorded.
--   from_statement:      the row was created by a card-statement import.
--   no_receipt:          no receipt photo backs it (drives the "No receipt, ITC
--                        not claimed" flag); cleared when a scan is attached.
--   receipt_attached_at: when that scan was attached.
alter table public.receipts
  add column from_statement boolean not null default false,
  add column no_receipt boolean not null default false,
  add column receipt_attached_at timestamptz;

alter table public.receipts
  add constraint receipts_no_receipt_needs_statement
    check (not no_receipt or from_statement);

-- Finds statement-created expenses still waiting for a receipt (scan -> attach).
create index receipts_awaiting_receipt_idx
  on public.receipts (user_id, transaction_date) where no_receipt;

-- Deleting an expense that came from (or was matched to) a statement line frees
-- the line instead of leaving a dangling claim: it goes back to 'skipped', so it
-- no longer counts as "already imported" and can be imported again.
-- SECURITY DEFINER because owners have no UPDATE right on statement_lines.
--
-- This sits on the delete path of every receipt, so it is written to do nothing
-- for an ordinary one:
--   * a statement-created expense (from_statement) is the only kind that can be
--     some line's created_receipt_id, so that branch is skipped for everything else;
--   * a receipt MATCHED to a line is an ordinary receipt, so it can only be found
--     by looking at statement_lines - one lookup on the partial unique index
--     statement_lines_matched_receipt_idx (the `is not null` repeats that index's
--     predicate so the planner can use it). For a receipt no line points at, that
--     lookup finds nothing and writes nothing.
create function public.release_statement_lines_on_receipt_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.from_statement then
    update public.statement_lines
       set resolution = 'skipped', matched_receipt_id = null, created_receipt_id = null
     where created_receipt_id = old.id;
  end if;

  update public.statement_lines
     set resolution = 'skipped', matched_receipt_id = null, created_receipt_id = null
   where matched_receipt_id is not null and matched_receipt_id = old.id;

  return old;
end;
$$;

revoke all on function public.release_statement_lines_on_receipt_delete()
  from public, anon, authenticated;

create trigger receipts_release_statement_lines
  before delete on public.receipts
  for each row execute function public.release_statement_lines_on_receipt_delete();

commit;
