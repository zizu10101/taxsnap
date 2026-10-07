-- Remember what a statement line USED to be when its expense or matched receipt is deleted.
-- Requires 0052 and 0053. Rollback: supabase/rollbacks/0058_statement_line_release_rollback.sql
--
-- Deleting an expense that came from a statement (or a receipt that was matched to one) frees its
-- statement line: 0053's trigger sets resolution = 'skipped' and clears created_receipt_id /
-- matched_receipt_id. That is right for "can be imported again", but it ERASES what the line was, so
-- a saved statement can no longer say how many expenses it created or matched, and a deliberately
-- excluded line can't be told from one whose expense was deleted.
--
-- Two nullable columns keep that history:
--   released_at    when the line was freed by a delete (or by "Delete statement" unlinking it)
--   released_from  what it was before: 'new_expense' (an expense it created) or 'matched'
-- Both set together or neither (a check). Existing rows keep both null: lines freed BEFORE this
-- migration stay "not saved" - their history was already overwritten and is not guessed at.
--
-- This also REPLACES the 0053 trigger function release_statement_lines_on_receipt_delete(): the
-- original body, line for line, with the two assignments added to each of its two updates. In a
-- single UPDATE the right-hand sides read the row's OLD values, so `released_from` captures the
-- resolution as it was before being set to 'skipped'. Signature, SECURITY DEFINER, search_path and the
-- trigger itself are unchanged; `create or replace` keeps the existing grants (none for anon,
-- authenticated or public).

begin;

alter table public.statement_lines
  add column released_at timestamptz,
  add column released_from text check (released_from in ('new_expense', 'matched'));

alter table public.statement_lines
  add constraint statement_lines_released_both_or_neither
    check ((released_at is null) = (released_from is null));

create or replace function public.release_statement_lines_on_receipt_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.from_statement then
    update public.statement_lines
       set released_at = case when resolution in ('new_expense', 'matched') then now() end,
           released_from = case when resolution in ('new_expense', 'matched') then resolution end,
           resolution = 'skipped', matched_receipt_id = null, created_receipt_id = null
     where created_receipt_id = old.id;
  end if;

  update public.statement_lines
     set released_at = case when resolution in ('new_expense', 'matched') then now() end,
         released_from = case when resolution in ('new_expense', 'matched') then resolution end,
         resolution = 'skipped', matched_receipt_id = null, created_receipt_id = null
   where matched_receipt_id is not null and matched_receipt_id = old.id;

  return old;
end;
$$;

commit;
