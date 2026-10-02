-- Owner-managed lists for the accountant's requests: bank accounts (what a
-- payment was deposited to) and custom expense categories (merged with the
-- fixed TAX_CATEGORIES list in the app at display time - that list is never
-- touched or stored here).
--
-- Both are per-account (user_id), names unique case-insensitively, and
-- "removing" one just deactivates it (is_active = false) so historical
-- payments/receipts keep their label and still appear in reports.

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.bank_accounts enable row level security;

create unique index if not exists bank_accounts_user_name_ci_idx
  on public.bank_accounts (user_id, lower(btrim(name)));

create policy "Users can view own bank accounts"
  on public.bank_accounts for select using (auth.uid() = user_id);
create policy "Users can insert own bank accounts"
  on public.bank_accounts for insert with check (auth.uid() = user_id);
create policy "Users can update own bank accounts"
  on public.bank_accounts for update using (auth.uid() = user_id);
create policy "Users can delete own bank accounts"
  on public.bank_accounts for delete using (auth.uid() = user_id);

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.expense_categories enable row level security;

create unique index if not exists expense_categories_user_name_ci_idx
  on public.expense_categories (user_id, lower(btrim(name)));

create policy "Users can view own expense categories"
  on public.expense_categories for select using (auth.uid() = user_id);
create policy "Users can insert own expense categories"
  on public.expense_categories for insert with check (auth.uid() = user_id);
create policy "Users can update own expense categories"
  on public.expense_categories for update using (auth.uid() = user_id);
create policy "Users can delete own expense categories"
  on public.expense_categories for delete using (auth.uid() = user_id);

-- Optional "Deposited to" on a payment. No ON DELETE action (NO ACTION, not
-- RESTRICT): deleting a user cascades to both their payments and their bank
-- accounts, and NO ACTION is checked at end of statement so that cascade is
-- not blocked. The app never hard-deletes an account, only deactivates it.
alter table public.payments
  add column if not exists bank_account_id uuid references public.bank_accounts (id);

create index if not exists payments_bank_account_id_idx on public.payments (bank_account_id);

-- Renames a custom category and carries the new spelling onto every receipt
-- and expense template that used the old one, in one transaction -
-- receipts.tax_category is plain text (not a foreign key), so without this a
-- rename would orphan history under the old name. SECURITY INVOKER: RLS still
-- scopes every statement to the caller's own rows.
create or replace function public.rename_expense_category(p_id uuid, p_new_name text)
returns public.expense_categories
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old text;
  v_new text := btrim(p_new_name);
  v_row public.expense_categories;
begin
  select name into v_old from public.expense_categories where id = p_id and user_id = auth.uid();
  if v_old is null then
    raise exception 'CATEGORY_NOT_FOUND';
  end if;

  update public.expense_categories set name = v_new
    where id = p_id and user_id = auth.uid()
    returning * into v_row;

  update public.receipts set tax_category = v_new
    where user_id = auth.uid() and lower(btrim(tax_category)) = lower(btrim(v_old));
  update public.expense_templates set default_tax_category = v_new
    where user_id = auth.uid() and lower(btrim(default_tax_category)) = lower(btrim(v_old));

  return v_row;
end;
$$;
