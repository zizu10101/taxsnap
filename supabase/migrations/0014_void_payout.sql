-- Void-and-redo for payouts the stylist hasn't confirmed yet - handles a
-- stylist disputing a payout (wrong total, wrong entries, even wrong
-- stylist) before they've confirmed it. A confirmed payout can never be
-- voided through this - unwinding a confirmed record is explicitly out of
-- scope, left to a future "adjustments" feature instead.

-- void_payout: same security-definer pattern as create_payout/confirm_payout.
-- Locks the payout row first (`for update`), same reasoning as
-- create_payout's entry-locking - closes the race where a double-tap or a
-- concurrent request could otherwise both pass the status checks before
-- either commits its update.
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

  -- Unlink first, then void - a payout can never end up voided while
  -- entries still point at it (they'd silently vanish from both the Paid
  -- and Unpaid views), and this order means if anything after this failed,
  -- the entries are already safely back to unpaid regardless.
  update public.commission_entries
  set payout_id = null
  where payout_id = p_payout_id;

  update public.payouts
  set status = 'voided'
  where id = p_payout_id
  returning * into v_payout;

  return v_payout;
end;
$$;
