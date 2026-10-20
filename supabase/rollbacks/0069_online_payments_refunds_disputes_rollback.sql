-- Undo 0069. It REFUSES to run while any refund or lost-dispute row exists: those rows are real
-- money movements, and the old schema (one row per payment intent and source, no dispute source)
-- could not hold them. Deleting them silently would put the books out; review them first.
begin;

do $$
begin
  if exists (select 1 from public.payments where source in ('stripe_refund','stripe_dispute')) then
    raise exception 'payments has refund / dispute rows - resolve them before rolling back 0069';
  end if;
end $$;

drop table if exists public.stripe_overpayments;
drop table if exists public.stripe_disputes;
alter table public.documents drop column if exists payment_disputed;

drop index if exists public.payments_stripe_dispute_uniq;
drop index if exists public.payments_stripe_refund_uniq;
drop index if exists public.payments_stripe_pi_uniq;
create unique index if not exists payments_stripe_pi_source_uniq
  on public.payments (stripe_payment_intent_id, source) where stripe_payment_intent_id is not null;

alter table public.payments drop constraint if exists payments_stripe_sign_check;
alter table public.payments drop constraint if exists payments_source_check;
alter table public.payments
  add constraint payments_source_check check (source in ('manual','stripe','stripe_refund'));
alter table public.payments
  drop column if exists stripe_dispute_id,
  drop column if exists stripe_refund_id;

commit;
