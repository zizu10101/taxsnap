-- Commission payouts: lets the owner batch up a stylist's outstanding
-- (unpaid, non-deleted) commission entries in a date range into a single
-- payout record, and soft-deletes commission_entries instead of hard
-- deleting them so a paid entry can never be destroyed.
--
-- total_amount is the sum of commission_owed (what's actually due to the
-- stylist), not price_charged (what the customer paid the business) -
-- deliberately confirmed, since those two numbers are very different and
-- silently summing the wrong one would mean paying a stylist the full
-- ticket price instead of their commission cut.

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references public.stylists (id) on delete restrict,
  paid_at timestamptz not null default now(),
  -- Stored at creation time, never recalculated - if a linked entry is
  -- later voided/edited, this must not silently drift from what was
  -- actually paid out.
  total_amount numeric(12, 2) not null,
  range_start date not null,
  range_end date not null,
  confirmed_by_stylist boolean not null default false,
  confirmed_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'voided')),
  created_at timestamptz not null default now()
);

alter table public.payouts enable row level security;

create index if not exists payouts_stylist_id_idx on public.payouts (stylist_id);

-- payouts has no user_id column, so RLS checks ownership through the
-- parent stylist, same pattern as payments -> documents.
create policy "Users can view own payouts"
  on public.payouts for select
  using (
    exists (
      select 1 from public.stylists s
      where s.id = payouts.stylist_id and s.user_id = auth.uid()
    )
  );

-- No insert policy and no update policy: payouts are only ever created via
-- create_payout() and confirmed via confirm_payout(), both security-definer
-- functions that verify ownership themselves and bypass RLS to do their
-- writes atomically. This closes the gap where a plain "for update using"
-- policy would let a client rewrite total_amount or status directly via
-- supabase-js, bypassing every business rule the API layer encodes.

-- ---------------------------------------------------------------------------
-- commission_entries: link to the payout that paid it out, and soft-delete
-- ---------------------------------------------------------------------------
alter table public.commission_entries
  add column if not exists payout_id uuid references public.payouts (id) on delete set null,
  add column if not exists is_deleted boolean not null default false,
  add column if not exists deleted_at timestamptz;

create index if not exists commission_entries_payout_id_idx
  on public.commission_entries (payout_id);

-- Hot path for both the Reports "Unpaid" filter and create_payout()'s own
-- lookup below - narrows straight to the outstanding rows for a stylist.
create index if not exists commission_entries_unpaid_idx
  on public.commission_entries (stylist_id, created_at)
  where is_deleted = false and payout_id is null;

-- ---------------------------------------------------------------------------
-- create_payout: atomically sums a stylist's outstanding entries in a date
-- range, inserts the payout row, and links those entries to it. Runs as a
-- single plpgsql function body, which Postgres already wraps in one
-- transaction - if anything raises (ownership check, no entries found),
-- every change made so far in the function is rolled back automatically.
--
-- The unpaid entries are locked with `for update` in the same CTE used to
-- compute the sum, not a separate plain SELECT followed by an UPDATE. Under
-- READ COMMITTED, two concurrent calls (double-tap, two tabs) could otherwise
-- both SELECT the same unpaid rows before either UPDATEs them, each compute
-- the same total, and each insert its own payout row - leaving one payout
-- with no linked entries once the UPDATEs race. `for update` makes the
-- second caller block until the first commits, then re-evaluate against the
-- now-updated rows, so it correctly finds zero unpaid entries and raises
-- NO_UNPAID_ENTRIES instead of creating a duplicate.
--
-- range_start/range_end are plain dates (the owner picks a date range, no
-- time component), but created_at is timestamptz - comparing against a
-- bare range_end date would exclude anything logged later that same day,
-- same bug class already fixed once in GET /api/commission-entries, so
-- this uses the same exclusive "< range_end + 1 day" upper bound.
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
  v_total numeric(12, 2);
  v_payout public.payouts;
begin
  if not exists (
    select 1 from public.stylists
    where id = p_stylist_id and user_id = v_user_id
  ) then
    raise exception 'STYLIST_NOT_FOUND';
  end if;

  with locked as (
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
  select coalesce(sum(commission_owed), 0) into v_total from locked;

  if v_total = 0 then
    raise exception 'NO_UNPAID_ENTRIES';
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

  return v_payout;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_payout: the only path that can set confirmed_by_stylist/confirmed_at.
-- Mirrors create_payout's pattern (ownership check + security definer) rather
-- than relying on a generic RLS update policy, which would otherwise let a
-- client set any column on a payout it owns - including total_amount or
-- status - not just the confirmation fields the app intends to expose.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_payout(
  p_payout_id uuid
)
returns public.payouts
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payout public.payouts;
begin
  update public.payouts p
  set confirmed_by_stylist = true,
      confirmed_at = now()
  from public.stylists s
  where p.id = p_payout_id
    and p.stylist_id = s.id
    and s.user_id = v_user_id
  returning p.* into v_payout;

  if v_payout.id is null then
    raise exception 'PAYOUT_NOT_FOUND';
  end if;

  return v_payout;
end;
$$;