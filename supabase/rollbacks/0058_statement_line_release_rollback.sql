-- Rollback for 0058_statement_line_release.sql. NOT in supabase/migrations/ on purpose: that folder is
-- applied in order, and this must only ever be run by hand.
--
-- Restores the exact 0053 trigger function (no released_* assignments) and drops the two columns.
-- What is lost: the history of which lines were freed and what they used to be. No expense, receipt,
-- statement or amount is deleted. Run it only while no expense or statement is being deleted.

begin;

create or replace function public.release_statement_lines_on_receipt_delete()
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

alter table public.statement_lines
  drop constraint if exists statement_lines_released_both_or_neither,
  drop column if exists released_from,
  drop column if exists released_at;

commit;
