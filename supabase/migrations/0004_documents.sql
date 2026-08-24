-- Clients + Invoice/Estimate ("documents") schema for the Pro invoicing &
-- estimates builder. Supersedes the old flat `invoices` table (left in
-- place, unused - safe to drop later once you're sure you don't need it).

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  email text,
  address text,
  created_at timestamptz not null default now()
);

alter table public.clients enable row level security;

create index if not exists clients_user_id_idx on public.clients (user_id);

create policy "Users can view own clients"
  on public.clients for select
  using (auth.uid() = user_id);

create policy "Users can insert own clients"
  on public.clients for insert
  with check (auth.uid() = user_id);

create policy "Users can update own clients"
  on public.clients for update
  using (auth.uid() = user_id);

create policy "Users can delete own clients"
  on public.clients for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- documents: a single invoice or estimate
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id uuid references public.clients (id) on delete set null,
  type text not null check (type in ('invoice', 'estimate')),
  status text not null default 'draft' check (status in ('draft', 'sent', 'paid')),
  issue_date date not null default current_date,
  due_date date,
  subtotal numeric(12, 2) not null default 0,
  hst_amount numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) not null default 0,
  -- Set when an invoice was created via "Convert to Invoice" from an estimate.
  converted_from_id uuid references public.documents (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.documents enable row level security;

create index if not exists documents_user_id_idx on public.documents (user_id);
create index if not exists documents_type_idx on public.documents (type);
create index if not exists documents_issue_date_idx on public.documents (issue_date);

create policy "Users can view own documents"
  on public.documents for select
  using (auth.uid() = user_id);

create policy "Users can insert own documents"
  on public.documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update own documents"
  on public.documents for update
  using (auth.uid() = user_id);

create policy "Users can delete own documents"
  on public.documents for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- document_items: line items for a document
-- ---------------------------------------------------------------------------
create table if not exists public.document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  description text not null,
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.document_items enable row level security;

create index if not exists document_items_document_id_idx on public.document_items (document_id);

-- document_items has no user_id column, so RLS checks ownership through the
-- parent document instead.
create policy "Users can view own document items"
  on public.document_items for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_items.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can insert own document items"
  on public.document_items for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = document_items.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can update own document items"
  on public.document_items for update
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_items.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can delete own document items"
  on public.document_items for delete
  using (
    exists (
      select 1 from public.documents d
      where d.id = document_items.document_id and d.user_id = auth.uid()
    )
  );
