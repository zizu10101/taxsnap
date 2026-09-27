-- Multi-item Register transactions: a cart-style checkout can now ring up
-- several services (each with its own stylist) and/or products in one
-- sale, instead of the old 1-service-per-transaction model.
--
-- commission_entries stays the atomic per-service commission record - it's
-- what payouts/adjustments/edits (0012/0016/0018) all key off via
-- stylist_id + date range, and none of that machinery changes here. Each
-- service line item still inserts its own commission_entries row exactly
-- as before; it just now also carries a shared transaction_id linking it
-- to any sibling service/product items rung up in the same checkout.
--
-- Products carry no stylist attribution and no commission - they get
-- their own line-item table with no FK to stylists at all.

-- ---------------------------------------------------------------------------
-- products: mirrors services minus the commission-relevant color field -
-- color exists on services only because CommissionLogger's service grid is
-- color-coded; products have no equivalent UI need for one.
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  default_price numeric(10, 2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;

create index if not exists products_user_id_idx on public.products (user_id);

create policy "Users can view own products"
  on public.products for select
  using (auth.uid() = user_id);

create policy "Users can insert own products"
  on public.products for insert
  with check (auth.uid() = user_id);

create policy "Users can update own products"
  on public.products for update
  using (auth.uid() = user_id);

create policy "Users can delete own products"
  on public.products for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- register_transactions: one row per Submit tap on the Register, whether
-- it rang up one item or several. payment_method/tax_applied/tax_amount
-- are the canonical transaction-level values (payment method and the tax
-- toggle apply once to the whole sale, not per item) - subtotal/tax_amount/
-- total_amount are stored at creation time and never recomputed later
-- (e.g. if a line item is later soft-deleted) - same immutability
-- principle as payouts.total_amount never drifting after the fact.
-- ---------------------------------------------------------------------------
create table if not exists public.register_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_name text,
  payment_method text,
  tax_applied boolean not null default false,
  subtotal numeric(10, 2) not null default 0,
  tax_amount numeric(10, 2) not null default 0,
  total_amount numeric(10, 2) not null default 0,
  created_at timestamptz not null default now()
);

alter table public.register_transactions enable row level security;

create index if not exists register_transactions_user_id_idx
  on public.register_transactions (user_id);
create index if not exists register_transactions_created_at_idx
  on public.register_transactions (created_at);

create policy "Users can view own register transactions"
  on public.register_transactions for select
  using (auth.uid() = user_id);

-- No insert/update policy: rows are only ever created via
-- create_register_transaction() below (security definer, verifies
-- ownership of every referenced service/stylist/product itself), same
-- pattern as payouts having no client-writable insert policy.

-- ---------------------------------------------------------------------------
-- register_transaction_products: product line items on a transaction. No
-- stylist_id, no commission fields - pure shop revenue, kept fully
-- separate from the commission-eligible side of a sale.
--
-- product_name/price_charged are snapshotted at sale time, same
-- denormalization reasoning as commission_entries.service_name/
-- price_charged - a later product rename/price change must not rewrite a
-- past sale's own record of what was actually charged.
-- ---------------------------------------------------------------------------
create table if not exists public.register_transaction_products (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.register_transactions (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  price_charged numeric(10, 2) not null,
  -- Per-item tax snapshot, same shape as commission_entries.tax_amount -
  -- summing every item's own tax_amount (services + products) gives the
  -- transaction's total tax with no separate transaction-level figure to
  -- keep in sync.
  tax_amount numeric(10, 2),
  -- Soft-delete, same pattern and same reasoning as
  -- commission_entries.is_deleted - lets DELETE /api/register-transactions/
  -- [id] (the multi-item cart's Undo action) remove a product line item
  -- without a hard delete, while register_transactions.subtotal/
  -- total_amount stay exactly as first charged (see that table's own
  -- comment on immutability).
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);

-- register_transaction_products has no user_id column - RLS checks
-- ownership through the parent transaction, same pattern as
-- document_items -> documents.
alter table public.register_transaction_products enable row level security;

create index if not exists register_transaction_products_transaction_id_idx
  on public.register_transaction_products (transaction_id);

create policy "Users can view own register transaction products"
  on public.register_transaction_products for select
  using (
    exists (
      select 1 from public.register_transactions t
      where t.id = register_transaction_products.transaction_id
        and t.user_id = auth.uid()
    )
  );

-- No insert/update/delete policy - only ever written by
-- create_register_transaction() below.

-- ---------------------------------------------------------------------------
-- commission_entries: link to the transaction it was rung up as part of.
-- Nullable and never backfilled - every entry logged before this migration
-- keeps transaction_id = null forever and stays a standalone legacy
-- single-service transaction, exactly as it already behaves today.
-- ---------------------------------------------------------------------------
alter table public.commission_entries
  add column if not exists transaction_id uuid
    references public.register_transactions (id) on delete set null;

create index if not exists commission_entries_transaction_id_idx
  on public.commission_entries (transaction_id);

-- ---------------------------------------------------------------------------
-- create_register_transaction: atomically inserts the transaction header
-- plus every service (-> commission_entries) and product
-- (-> register_transaction_products) line item in one go, so a
-- multi-item cart can never partially land (header written but a later
-- item's insert fails).
--
-- Deliberately takes each item's price_charged/commission_rate_applied/
-- tax_amount already resolved by the caller, rather than looking up
-- services/stylists/products and computing tax itself in plpgsql - same
-- reasoning as 0024_commission_payment_tax.sql's own comment: the HST
-- rate is a policy constant that lives in application code
-- (src/lib/hst.ts), and duplicating it here would risk the two drifting.
-- The API route (POST /api/register-transactions) is itself server-side,
-- so this preserves the exact same trust boundary the old single-entry
-- POST /api/commission-entries already used (price/rate looked up from
-- the live service/stylist row server-side, never trusted from the
-- browser) - this function's own job is purely the atomic multi-row
-- write and re-verifying that every referenced id actually belongs to the
-- caller, not re-deriving pricing.
--
-- p_services: jsonb array of
--   {service_id, stylist_id, price_charged, commission_rate_applied, tax_amount}
-- p_products: jsonb array of
--   {product_id, price_charged, tax_amount}
create or replace function public.create_register_transaction(
  p_customer_name text,
  p_payment_method text,
  p_tax_applied boolean,
  p_services jsonb,
  p_products jsonb
)
returns public.register_transactions
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_transaction public.register_transactions;
  v_subtotal numeric(10, 2) := 0;
  v_tax_total numeric(10, 2) := 0;
  v_item jsonb;
  v_service_id uuid;
  v_stylist_id uuid;
  v_product_id uuid;
  v_price numeric(10, 2);
  v_rate numeric(5, 4);
  v_tax numeric(10, 2);
  v_service_name text;
  v_product_name text;
  v_customer_name text := nullif(btrim(coalesce(p_customer_name, '')), '');
begin
  if jsonb_array_length(coalesce(p_services, '[]'::jsonb)) = 0
     and jsonb_array_length(coalesce(p_products, '[]'::jsonb)) = 0 then
    raise exception 'NO_ITEMS';
  end if;

  insert into public.register_transactions (
    user_id, customer_name, payment_method, tax_applied, subtotal, tax_amount, total_amount
  ) values (
    v_user_id, v_customer_name, p_payment_method, coalesce(p_tax_applied, false), 0, 0, 0
  ) returning * into v_transaction;

  for v_item in select * from jsonb_array_elements(coalesce(p_services, '[]'::jsonb))
  loop
    v_service_id := (v_item->>'service_id')::uuid;
    v_stylist_id := (v_item->>'stylist_id')::uuid;
    v_price := (v_item->>'price_charged')::numeric;
    v_rate := (v_item->>'commission_rate_applied')::numeric;
    v_tax := case when v_item->>'tax_amount' is null then null else (v_item->>'tax_amount')::numeric end;

    select name into v_service_name from public.services
      where id = v_service_id and user_id = v_user_id;
    if v_service_name is null then
      raise exception 'SERVICE_NOT_FOUND';
    end if;
    if not exists (select 1 from public.stylists where id = v_stylist_id and user_id = v_user_id) then
      raise exception 'STYLIST_NOT_FOUND';
    end if;

    insert into public.commission_entries (
      user_id, stylist_id, service_id, service_name, customer_name,
      price_charged, commission_rate_applied, payment_method, tax_applied, tax_amount,
      transaction_id
    ) values (
      v_user_id, v_stylist_id, v_service_id, v_service_name, v_customer_name,
      v_price, v_rate, p_payment_method, coalesce(p_tax_applied, false), v_tax,
      v_transaction.id
    );

    v_subtotal := v_subtotal + v_price;
    v_tax_total := v_tax_total + coalesce(v_tax, 0);
  end loop;

  for v_item in select * from jsonb_array_elements(coalesce(p_products, '[]'::jsonb))
  loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_price := (v_item->>'price_charged')::numeric;
    v_tax := case when v_item->>'tax_amount' is null then null else (v_item->>'tax_amount')::numeric end;

    select name into v_product_name from public.products
      where id = v_product_id and user_id = v_user_id;
    if v_product_name is null then
      raise exception 'PRODUCT_NOT_FOUND';
    end if;

    insert into public.register_transaction_products (
      transaction_id, product_id, product_name, price_charged, tax_amount
    ) values (
      v_transaction.id, v_product_id, v_product_name, v_price, v_tax
    );

    v_subtotal := v_subtotal + v_price;
    v_tax_total := v_tax_total + coalesce(v_tax, 0);
  end loop;

  update public.register_transactions
  set subtotal = v_subtotal,
      tax_amount = v_tax_total,
      total_amount = v_subtotal + v_tax_total
  where id = v_transaction.id
  returning * into v_transaction;

  return v_transaction;
end;
$$;
