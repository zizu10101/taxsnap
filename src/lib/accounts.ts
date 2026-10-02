// The owner's single list of accounts (bank_accounts, see 0047/0048): each is
// a bank account - offered under "Deposited to" on a payment, since it can
// receive money - or a credit card, which can only be what an expense was
// "Paid with". Pure helpers, shared by the pickers and tested on their own.

export type AccountType = "bank" | "card";

export interface AccountLike {
  id: string;
  name: string;
  is_active: boolean;
  // Rows predating 0048 (or a client running ahead of the migration) have no
  // type - they're bank accounts, which is what every account was before.
  account_type?: AccountType | null;
}

export function accountTypeOf(account: AccountLike): AccountType {
  return account.account_type === "card" ? "card" : "bank";
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank account",
  card: "Credit card",
};

// Active accounts that can receive a customer payment, plus the one a payment
// already points at (even if since deactivated, or somehow a card) so editing
// that payment keeps showing - and keeping - its value.
export function depositAccounts<T extends AccountLike>(accounts: T[], currentId?: string): T[] {
  return accounts.filter(
    (a) => (a.is_active && accountTypeOf(a) === "bank") || a.id === currentId,
  );
}

// Active accounts of either type, plus the one an expense already points at.
export function paidWithAccounts<T extends AccountLike>(accounts: T[], currentId?: string): T[] {
  return accounts.filter((a) => a.is_active || a.id === currentId);
}

// "Name", "Name (credit card)" when it isn't a bank account, and "(inactive)"
// appended for a deactivated one - what a picker option or a CSV cell shows.
export function accountDisplayName(account: AccountLike, opts: { withType?: boolean } = {}): string {
  let label = account.name;
  if (opts.withType && accountTypeOf(account) === "card") label += " (credit card)";
  if (!account.is_active) label += " (inactive)";
  return label;
}
