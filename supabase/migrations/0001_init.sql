-- TaxSnap initial schema: profiles, receipts, invoices + RLS policies.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  stripe_customer_id text unique,
  subscription_status text not null default 'free'
    check (subscription_status in ('free', 'basic', 'pro')),
  business_type text not null default 'General Trade',
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------------
-- receipts
-- ---------------------------------------------------------------------------
create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  image_url text,
  merchant_name text not null,
  transaction_date date not null,
  total_amount numeric(12, 2) not null default 0,
  tax_amount numeric(12, 2) not null default 0,
  tax_category text not null default 'Other',
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.receipts enable row level security;

create index if not exists receipts_user_id_idx on public.receipts (user_id);
create index if not exists receipts_transaction_date_idx on public.receipts (transaction_date);

create policy "Users can view own receipts"
  on public.receipts for select
  using (auth.uid() = user_id);

create policy "Users can insert own receipts"
  on public.receipts for insert
  with check (auth.uid() = user_id);

create policy "Users can update own receipts"
  on public.receipts for update
  using (auth.uid() = user_id);

create policy "Users can delete own receipts"
  on public.receipts for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- invoices (Pro tier)
-- ---------------------------------------------------------------------------
create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_name text not null,
  client_email text,
  line_items jsonb not null default '[]'::jsonb,
  total_amount numeric(12, 2) not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid')),
  created_at timestamptz not null default now()
);

alter table public.invoices enable row level security;

create index if not exists invoices_user_id_idx on public.invoices (user_id);

create policy "Users can view own invoices"
  on public.invoices for select
  using (auth.uid() = user_id);

create policy "Users can insert own invoices"
  on public.invoices for insert
  with check (auth.uid() = user_id);

create policy "Users can update own invoices"
  on public.invoices for update
  using (auth.uid() = user_id);

create policy "Users can delete own invoices"
  on public.invoices for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- storage: receipts bucket for uploaded photos
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

create policy "Users can upload their own receipt images"
  on storage.objects for insert
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can view their own receipt images"
  on storage.objects for select
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own receipt images"
  on storage.objects for delete
  using (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
