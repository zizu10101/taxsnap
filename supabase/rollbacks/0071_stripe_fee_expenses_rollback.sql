-- Undo 0071. Refuses to run while any automatic Stripe fee expense exists, because dropping
-- `origin` would turn those rows into ordinary expenses with no label and no link back to
-- their payment. Delete them first (Expenses page, or:
--   delete from public.receipts where origin = 'stripe';).
begin;

do $$
begin
  if exists (select 1 from public.receipts where origin = 'stripe') then
    raise exception 'automatic Stripe fee expenses exist; delete them before rolling back 0071';
  end if;
end $$;

drop function if exists public.record_stripe_fee_expense(uuid, uuid, text, text, date, numeric, text, jsonb);
drop trigger if exists receipts_stripe_origin_guard on public.receipts;
drop function if exists public.receipts_stripe_origin_guard();

drop index if exists public.receipts_stripe_payment_uniq;
drop index if exists public.receipts_stripe_dispute_uniq;
alter table public.receipts drop constraint if exists receipts_stripe_origin_check;
alter table public.receipts
  drop column if exists origin,
  drop column if exists stripe_payment_id,
  drop column if exists stripe_dispute_id;

alter table public.payments drop column if exists fee_expense_outcome;
alter table public.stripe_disputes drop column if exists fee_expense_outcome;
alter table public.profiles drop column if exists record_stripe_fee_expenses;

commit;
