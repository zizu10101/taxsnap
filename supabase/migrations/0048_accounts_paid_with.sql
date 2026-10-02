-- "Paid with" on expenses, sharing the owner-managed list from 0047.
--
-- bank_accounts becomes the owner's single list of accounts, each either a
-- bank account (can receive customer payments, so it's offered under
-- "Deposited to") or a credit card. Expenses can be paid with either, so
-- "Paid with" offers both. One shared list means "Business Checking" is spelled
-- and renamed in one place, and an accountant can reconcile one account across
-- deposits and spending. The table keeps its 0047 name.
--
-- Every existing account becomes 'bank', so "Deposited to" behaves exactly as
-- before. Names stay unique per account across both types (0047's index).

alter table public.bank_accounts
  add column if not exists account_type text not null default 'bank'
    check (account_type in ('bank', 'card'));

-- Optional, nullable, and no ON DELETE action (NO ACTION - an account with
-- history is deactivated by the app, never deleted; NO ACTION also lets a
-- user deletion cascade through receipts and accounts in one statement).
alter table public.receipts
  add column if not exists paid_with_account_id uuid references public.bank_accounts (id);

create index if not exists receipts_paid_with_account_id_idx
  on public.receipts (paid_with_account_id);

-- A recurring expense can remember how it's usually paid.
alter table public.expense_templates
  add column if not exists default_paid_with_account_id uuid references public.bank_accounts (id);
