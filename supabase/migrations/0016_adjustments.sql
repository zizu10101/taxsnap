-- Corrections for a payout AFTER the stylist has already confirmed it.
-- Confirmed payouts stay permanent - never voided, never edited directly
-- (see void_payout's own PAYOUT_ALREADY_CONFIRMED guard, 0014_void_payout.sql).
-- A correction instead becomes its own row here and gets folded into the
-- stylist's *next* payout, like fixing a paycheck via the following pay
-- period rather than rewriting last week's stub.

create table if not exists public.adjustments (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylists (id) on delete restrict,
  amount numeric(12, 2) not null, -- positive = owed more, negative = owed less
  reason text not null,
  related_payout_id uuid references public.payouts (id), -- which confirmed payout this corrects
  applied_payout_id uuid references public.payouts (id), -- which future payout absorbed it, null until applied
  created_at timestamptz not null default now()
);

alter table public.adjustments enable row level security;

create index if not exists adjustments_stylist_id_idx on public.adjustments (stylist_id);
-- Hot path for create_payout's own lookup below - unapplied adjustments
-- for a stylist, same idea as commission_entries_unpaid_idx.
create index if not exists adjustments_unapplied_idx
  on public.adjustments (stylist_id)
  where applied_payout_id is null;

-- adjustments has no user_id column, so RLS checks ownership through the
-- parent stylist, same pattern as payments -> documents and payouts ->
-- stylists. Select only - no insert/update policy, same reasoning as
-- payouts: writes only ever happen through create_adjustment() and
-- create_payout() below, both security-definer, so a client can't
-- fabricate an adjustment or edit one after the fact.
create policy "Users can view own adjustments"
  on public.adjustments for select
  using (
    exists (
      select 1 from public.stylists s
      where s.id = adjustments.stylist_id and s.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- create_adjustment: the only way an adjustment is ever created. Only valid
-- against a payout that's confirmed and still active - an unconfirmed or
-- voided payout should go through void_payout (unwind it and redo it
-- correctly) rather than accumulate a correction on top of something that
-- was never locked in to begin with.
-- ---------------------------------------------------------------------------
create or replace function public.create_adjustment(
  p_stylist_id uuid,
  p_related_payout_id uuid,
  p_amount numeric,
  p_reason text
)
returns public.adjustments
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payout public.payouts;
  v_adjustment public.adjustments;
begin
  if not exists (
    select 1 from public.stylists
    where id = p_stylist_id and user_id = v_user_id
  ) then
    raise exception 'STYLIST_NOT_FOUND';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into v_payout
  from public.payouts
  where id = p_related_payout_id and stylist_id = p_stylist_id;

  if v_payout.id is null then
    raise exception 'PAYOUT_NOT_FOUND';
  end if;

  if v_payout.status <> 'active' or not v_payout.confirmed_by_stylist then
    raise exception 'PAYOUT_NOT_CONFIRMED';
  end if;

  insert into public.adjustments (stylist_id, amount, reason, related_payout_id)
  values (p_stylist_id, p_amount, btrim(p_reason), p_related_payout_id)
  returning * into v_adjustment;

  return v_adjustment;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_payout: now also folds in any unapplied adjustments for the
-- stylist (not date-range-filtered like entries - an adjustment corrects a
-- past confirmed payout, it isn't tied to a service date, so it's absorbed
-- into whichever payout comes next regardless of what range that covers).
--
-- The "nothing to pay out" check is now on *count* of entries+adjustments,
-- not on whether the combined dollar total is zero - a valid combination
-- (e.g. one unpaid entry plus a negative adjustment of the same size) can
-- legitimately net to zero or near-zero and should still be creatable, and
-- conversely a stylist can have zero new entries but still be owed a
-- pending adjustment on its own, which should still produce a payout.
-- ---------------------------------------------------------------------------
create or replace function public.create_payout(
  p_stylist_id uuid,
  p_range_start date,
  p_range_end date
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
      and created_at >= p_range_start
      and created_at < (p_range_end + 1)
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

  -- A large enough negative adjustment could otherwise outweigh the
  -- entries and produce a payout that says the owner is owed money *by*
  -- the stylist, which isn't a real payout - reject outright rather than
  -- silently creating one. Nothing has been written yet at this point
  -- (only the `for update` locks taken above, released on the raise), so
  -- the entries and adjustment stay exactly as they were for a future
  -- attempt with a different range or after a further correction.
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
    and created_at >= p_range_start
    and created_at < (p_range_end + 1);

  update public.adjustments
  set applied_payout_id = v_payout.id
  where stylist_id = p_stylist_id
    and applied_payout_id is null;

  return v_payout;
end;
$$;
