-- create_payout() previously filtered commission_entries.created_at
-- (timestamptz) against p_range_start/p_range_end (plain dates) directly:
--   created_at >= p_range_start and created_at < (p_range_end + 1)
-- A bare date compared against a timestamptz is implicitly cast in the
-- database's session timezone (UTC on Supabase), not the shop's local
-- timezone - so for any North American shop, "today" started several hours
-- before actual local midnight, letting the tail end of the previous local
-- day's entries get bundled into a payout meant to only cover the range
-- starting today. Same root cause as the "Today" filter bug fixed in
-- GET /api/commission-entries and GET /api/payouts (see lib/date-range.ts's
-- rangeToUtcBounds), but this instance is more serious since it silently
-- affects which entries a real payout's dollar total includes.
--
-- Fix: the range boundaries used to *select* entries are now explicit
-- timestamptz instants (p_start_ts/p_end_ts), computed client-side where the
-- shop's real local UTC offset is actually known (see MarkAsPaidDialog).
-- p_range_start/p_range_end are kept as-is and still stored on the payout
-- row - they're display-only labels ("Aug 1 - Aug 15") with no timezone
-- semantics of their own, so they don't need to change.
drop function if exists public.create_payout(uuid, date, date);

create or replace function public.create_payout(
  p_stylist_id uuid,
  p_range_start date,
  p_range_end date,
  p_start_ts timestamptz,
  p_end_ts timestamptz
)
returns public.payouts
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_entries_total numeric(12, 2);
  v_entry_count int;
  v_adjustments_total numeric(12, 2);
  v_adjustment_count int;
  v_total numeric(12, 2);
  v_payout public.payouts;
begin
  if not exists (
    select 1 from public.stylists
    where id = p_stylist_id and user_id = v_user_id
  ) then
    raise exception 'STYLIST_NOT_FOUND';
  end if;

  with locked_entries as (
    select id, commission_owed
    from public.commission_entries
    where stylist_id = p_stylist_id
      and user_id = v_user_id
      and is_deleted = false
      and payout_id is null
      and created_at >= p_start_ts
      and created_at < p_end_ts
    for update
  )
  select coalesce(sum(commission_owed), 0), count(*)
  into v_entries_total, v_entry_count
  from locked_entries;

  with locked_adjustments as (
    select id, amount
    from public.adjustments
    where stylist_id = p_stylist_id
      and applied_payout_id is null
    for update
  )
  select coalesce(sum(amount), 0), count(*)
  into v_adjustments_total, v_adjustment_count
  from locked_adjustments;

  if v_entry_count = 0 and v_adjustment_count = 0 then
    raise exception 'NO_UNPAID_ENTRIES';
  end if;

  v_total := v_entries_total + v_adjustments_total;

  if v_total < 0 then
    raise exception 'NEGATIVE_PAYOUT_TOTAL';
  end if;

  insert into public.payouts (stylist_id, total_amount, range_start, range_end)
  values (p_stylist_id, v_total, p_range_start, p_range_end)
  returning * into v_payout;

  update public.commission_entries
  set payout_id = v_payout.id
  where stylist_id = p_stylist_id
    and user_id = v_user_id
    and is_deleted = false
    and payout_id is null
    and created_at >= p_start_ts
    and created_at < p_end_ts;

  update public.adjustments
  set applied_payout_id = v_payout.id
  where stylist_id = p_stylist_id
    and applied_payout_id is null;

  return v_payout;
end;
$$;
