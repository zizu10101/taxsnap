// Spending grouped by the account an expense was "Paid with" (see 0048). Pure
// functions, shared by the Reports "By Account" tab and tested on their own.
//
// This is TRACKED spending - what the owner logged in TaxSnap against an
// account - not that account's balance or statement total: the app has no
// connection to real bank or card balances.

// The account filter value / row id standing for "no account chosen". Always
// its own visible row so the rows add up to every expense in the range and a
// total can never silently understate real spending.
export const NOT_SPECIFIED = "none";

export interface SpendReceipt {
  total_amount: number;
  paid_with_account_id: string | null;
}

export interface SpendAccount {
  id: string;
  name: string;
  // Rows predating 0048 have no type - they're bank accounts.
  account_type?: "bank" | "card" | null;
  is_active: boolean;
}

export interface AccountSpendRow {
  // An account id, or NOT_SPECIFIED for expenses with no "Paid with".
  key: string;
  name: string;
  type: "bank" | "card" | null; // null for "Not specified"
  isActive: boolean;
  count: number;
  total: number;
}

export interface AccountSpendData {
  rows: AccountSpendRow[];
  // Sum of every row - equals the P&L's expenses for the same range.
  total: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// One row per active account (even at $0, so it's visible and pickable), one
// per deactivated account that still has spend in the range, and ALWAYS a
// "Not specified" row - even at $0. A receipt pointing at an account that is no
// longer in the list is grouped as "Removed account" rather than dropped.
// Sorted by spend, highest first, then by name.
export function groupSpendingByAccount(
  receipts: SpendReceipt[],
  accounts: SpendAccount[],
): AccountSpendData {
  const rows = new Map<string, AccountSpendRow>();
  for (const a of accounts) {
    rows.set(a.id, {
      key: a.id,
      name: a.name,
      type: a.account_type === "card" ? "card" : "bank",
      isActive: a.is_active,
      count: 0,
      total: 0,
    });
  }
  rows.set(NOT_SPECIFIED, {
    key: NOT_SPECIFIED,
    name: "Not specified",
    type: null,
    isActive: true,
    count: 0,
    total: 0,
  });

  for (const r of receipts) {
    const key = r.paid_with_account_id ?? NOT_SPECIFIED;
    let row = rows.get(key);
    if (!row) {
      row = { key, name: "Removed account", type: null, isActive: false, count: 0, total: 0 };
      rows.set(key, row);
    }
    row.count += 1;
    row.total += r.total_amount;
  }

  const list = [...rows.values()]
    .filter((r) => r.isActive || r.count > 0)
    .map((r) => ({ ...r, total: round2(r.total) }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return { rows: list, total: round2(list.reduce((sum, r) => sum + r.total, 0)) };
}

// Does an expense belong under an account filter value (an account id, or
// NOT_SPECIFIED for expenses with no account)?
export function matchesAccountFilter(paidWithAccountId: string | null, filter: string): boolean {
  return filter === NOT_SPECIFIED ? paidWithAccountId === null : paidWithAccountId === filter;
}
