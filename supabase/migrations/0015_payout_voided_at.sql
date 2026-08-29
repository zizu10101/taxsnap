-- The Paid view's voided-payouts summary needs to show when a payout was
-- voided - no existing column captures this (confirmed_at is unrelated),
-- so add one and have void_payout() set it alongside status.

alter table public.payouts
  add column if not exists voided_at timestamptz;

create or replace function public.void_payout(p_payout_id uuid)
returns public.payouts
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payout public.payouts;
begin
  select p.* into v_payout
  from public.payouts p
  join public.stylists s on s.id = p.stylist_id
  where p.id = p_payout_id and s.user_id = v_user_id
  for update of p;

  if v_payout.id is null then
    raise exception 'PAYOUT_NOT_FOUND';
  end if;

  if v_payout.confirmed_by_stylist then
    raise exception 'PAYOUT_ALREADY_CONFIRMED';
  end if;

  if v_payout.status = 'voided' then
    raise exception 'PAYOUT_ALREADY_VOIDED';
  end if;

  update public.commission_entries
  set payout_id = null
  where payout_id = p_payout_id;

  update public.payouts
  set status = 'voided', voided_at = now()
  where id = p_payout_id
  returning * into v_payout;

  return v_payout;
end;
$$;
