-- Stripe fees recorded as expenses automatically.
-- Rollback: supabase/rollbacks/0071_stripe_fee_expenses_rollback.sql
--
-- Run in the Supabase SQL Editor (after 0070) BEFORE the code that uses it ships.
-- Every change is additive: new nullable / defaulted columns, two partial unique indexes, one
-- trigger, one service-role function. No existing row is rewritten.
--
-- A Stripe processing fee carries no HST (owner's accountant), so the expense has tax_amount 0 and no
-- tax code. It is an ordinary `receipts` row, editable and deletable like any other, plus:
--   receipts.origin             'stripe' = created automatically from Stripe data (null = every other expense).
--                               Used to label the row and to leave it out of the Free plan's scan count.
--   receipts.stripe_payment_id  the payment whose fee this is        (unique where not null)
--   receipts.stripe_dispute_id  the dispute whose fee this is        (unique where not null)
--                               Both go back to null if the payment / dispute is deleted (the expense stays).
--   payments.fee_expense_outcome / stripe_disputes.fee_expense_outcome
--                               'recorded' = the fee expense was created; 'off' = the owner's switch was off at
--                               the time. Set ONCE, in the same transaction as the insert, and never cleared,
--                               so deleting the expense does not let a webhook retry create it again.
--   profiles.record_stripe_fee_expenses  the owner's switch, on by default.
--
-- record_stripe_fee_expense() is the only writer: it locks the payment / dispute row, returns null if an
-- outcome is already stored, otherwise inserts the expense and stores the outcome. service_role only.
--
-- The trigger stops a signed-in browser from setting origin / the links on its own expenses (that would
-- let a Free user hide an expense from the scan count). It still allows the links to be cleared, which is
-- what `on delete set null` does when an invoice is deleted.

begin;

alter table public.profiles
  add column if not exists record_stripe_fee_expenses boolean not null default true;

alter table public.payments
  add column if not exists fee_expense_outcome text
    check (fee_expense_outcome in ('recorded', 'off'));

alter table public.stripe_disputes
  add column if not exists fee_expense_outcome text
    check (fee_expense_outcome in ('recorded', 'off'));

alter table public.receipts
  add column if not exists origin text check (origin in ('stripe')),
  add column if not exists stripe_payment_id uuid references public.payments (id) on delete set null,
  add column if not exists stripe_dispute_id text references public.stripe_disputes (id) on delete set null;

alter table public.receipts
  add constraint receipts_stripe_origin_check
    check (
      (stripe_payment_id is null or stripe_dispute_id is null)
      and (stripe_payment_id is null and stripe_dispute_id is null or origin = 'stripe')
    );

create unique index if not exists receipts_stripe_payment_uniq
  on public.receipts (stripe_payment_id) where stripe_payment_id is not null;
create unique index if not exists receipts_stripe_dispute_uniq
  on public.receipts (stripe_dispute_id) where stripe_dispute_id is not null;

create function public.receipts_stripe_origin_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.origin is not null or new.stripe_payment_id is not null or new.stripe_dispute_id is not null then
        raise exception 'origin and Stripe links are set by the system only';
      end if;
    else
      if new.origin is distinct from old.origin
         or (new.stripe_payment_id is distinct from old.stripe_payment_id and new.stripe_payment_id is not null)
         or (new.stripe_dispute_id is distinct from old.stripe_dispute_id and new.stripe_dispute_id is not null) then
        raise exception 'origin and Stripe links are set by the system only';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger receipts_stripe_origin_guard
  before insert or update on public.receipts
  for each row execute function public.receipts_stripe_origin_guard();

create function public.record_stripe_fee_expense(
  p_user_id uuid,
  p_payment_id uuid,
  p_dispute_id text,
  p_merchant text,
  p_date date,
  p_amount numeric,
  p_category text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_outcome text;
  v_found boolean;
  v_id uuid;
begin
  if (p_payment_id is null) = (p_dispute_id is null) then
    raise exception 'give exactly one of payment or dispute';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'fee must be positive';
  end if;

  if p_payment_id is not null then
    select true, p.fee_expense_outcome into v_found, v_outcome
      from public.payments p
      join public.documents d on d.id = p.document_id
     where p.id = p_payment_id and d.user_id = p_user_id
       for update of p;
  else
    select true, s.fee_expense_outcome into v_found, v_outcome
      from public.stripe_disputes s
      join public.documents d on d.id = s.document_id
     where s.id = p_dispute_id and d.user_id = p_user_id
       for update of s;
  end if;

  if v_found is not true then
    raise exception 'payment or dispute not found for this user';
  end if;
  if v_outcome is not null then
    return null;  -- already handled (created before, or the switch was off); never again
  end if;

  insert into public.receipts
    (user_id, merchant_name, transaction_date, total_amount, tax_amount, tax_category, items,
     origin, stripe_payment_id, stripe_dispute_id)
  values
    (p_user_id, p_merchant, p_date, p_amount, 0, p_category, p_items,
     'stripe', p_payment_id, p_dispute_id)
  returning id into v_id;

  if p_payment_id is not null then
    update public.payments set fee_expense_outcome = 'recorded' where id = p_payment_id;
  else
    update public.stripe_disputes set fee_expense_outcome = 'recorded' where id = p_dispute_id;
  end if;
  return v_id;
end;
$$;

revoke all on function public.record_stripe_fee_expense(uuid, uuid, text, text, date, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_stripe_fee_expense(uuid, uuid, text, text, date, numeric, text, jsonb)
  to service_role;

commit;
