-- Payment history for invoices - lets a user log a deposit and a later
-- final payment separately instead of only an all-or-nothing "paid"
-- status. The HST Return Helper switches to summing actual payments
-- received within a period (pro-rated for tax) rather than an invoice's
-- full total, since GST/HST becomes collectible on a deposit at the time
-- it's received, not only once an invoice is fully paid.

alter table documents drop constraint if exists documents_status_check;
alter table documents add constraint documents_status_check
  check (status in ('draft', 'sent', 'partial', 'paid'));

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  amount numeric(12, 2) not null,
  paid_date date not null default current_date,
  method text,
  note text,
  created_at timestamptz not null default now()
);

alter table public.payments enable row level security;

create index if not exists payments_document_id_idx on public.payments (document_id);

-- payments has no user_id column, so RLS checks ownership through the
-- parent document, same pattern as document_items.
create policy "Users can view own payments"
  on public.payments for select
  using (
    exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can insert own payments"
  on public.payments for insert
  with check (
    exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );

create policy "Users can delete own payments"
  on public.payments for delete
  using (
    exists (
      select 1 from public.documents d
      where d.id = payments.document_id and d.user_id = auth.uid()
    )
  );
