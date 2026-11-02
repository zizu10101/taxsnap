// How statement money and dates are written. Pure and import-free, with NO "use client": server
// components (the Statements list) and client components both import from here. They used to live in
// statement-review-line.tsx, a "use client" file, and a server component that imported them from there
// crashed at runtime ("Attempted to call formatDay() from the server but formatDay is on the client").
// A function a server component needs must never live in a "use client" file.

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

// ---- display only ----------------------------------------------------------------------------------------------
// Stored amounts stay "signed as the card sees it" (money out +, money in -); nothing below changes a stored value or a
// calculation. These only decide how a figure is WRITTEN for the person.

const isBank = (accountType: string | null | undefined) => accountType !== "card";
const noNegativeZero = (n: number) => (Object.is(n, -0) || n === 0 ? 0 : n);

/** "+$615.57": a positive amount with an explicit plus sign. */
export const formatPlus = (amount: number) => `+${formatMoney(Math.abs(amount))}`;

/**
 * One statement line. Money out is a plain amount. Money in is "+$x", never a minus sign. On a credit card the
 * money-in line is labelled by what it is ("Payment +$x", "Refund +$x"), because a card has no "deposit".
 */
export function formatLineAmount(amount: number, accountType: string | null | undefined, kind?: string | null): string {
  if (amount >= 0) return formatMoney(amount);
  if (isBank(accountType)) return formatPlus(amount);
  const label = kind === "payment" ? "Payment" : kind === "refund" ? "Refund" : "Credit";
  return `${label} ${formatPlus(amount)}`;
}

/** A statement balance in the account's natural direction: what is IN a bank account, what is OWED on a card. Stored balances are "owed" for both, so a bank one is flipped. */
export function formatBalance(storedBalance: number, accountType: string | null | undefined): string {
  return formatMoney(isBank(accountType) ? noNegativeZero(-storedBalance) : storedBalance);
}

/**
 * A figure from the balance check. When it comes from the balances, a bank account shows the change in what is in it
 * (a plus sign when it grew); a card shows the change in what is owed, as before. A "total purchases" figure is the same
 * for both.
 */
export function formatReconcileFigure(value: number, accountType: string | null | undefined, basis: "balance_roll" | "purchases"): string {
  if (basis === "balance_roll" && isBank(accountType)) {
    const natural = noNegativeZero(-value);
    return natural > 0 ? formatPlus(natural) : formatMoney(natural);
  }
  return formatMoney(value);
}

/** The "Interest and fees" group help: "card fees" only on a credit card. */
export function bankChargesHelp(accountType: string | null | undefined): string {
  return `${isBank(accountType) ? "Interest and fees" : "Interest and card fees"}, saved as no-tax. Accept the suggested category, or choose another.`;
}

/** The Expenses banner for open drafts: "card" only when the waiting import is for a credit card. */
export function openDraftsBanner(accountTypes: Array<string | null | undefined>): string {
  const n = accountTypes.length;
  const word = accountTypes.every((t) => !isBank(t)) ? "card statement" : "statement";
  return n === 1 ? `You have a ${word} import waiting for review.` : `You have ${n} ${word} imports waiting for review.`;
}

/** A plain calendar date ("2026-02-08") in words: "Feb 8, 2026". No timezone shift. */
export function formatDay(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** A saved-at INSTANT as Toronto's calendar day ("Oct 7, 2026"), so it matches what the owner sees. */
export function formatSavedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/Toronto",
  });
}

// The "money in" group on a statement (kind "payment"). On a credit card it is a payment TO the card; on a bank
// account it is any money in (a deposit, a transfer in, interest paid). Neither is an expense.
// The heading of a statement when the bank or card issuer wasn't read off it (a CSV never has one).
export function statementTitle(issuer: string | null | undefined, accountType: string | null | undefined): string {
  return issuer || (accountType === "card" ? "Card statement" : "Bank statement");
}

export function moneyInCopy(accountType: string | null | undefined) {
  const bank = accountType !== "card";
  return {
    title: bank ? "Money in (not expenses)" : "Payments to the card",
    lineText: bank ? "Money in, not an expense - ignored." : "A payment to the card, not an expense - ignored.",
  };
}
