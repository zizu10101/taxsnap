// "Check whether any invoices were paid": a reminder on a BANK statement's money-in lines. DISPLAY AND LINKS ONLY -
// nothing here records a payment, marks an invoice paid or stores anything. The balance due comes from the one existing
// calculation (payment-form.ts balanceDue), so a partly paid invoice is compared by what is still owed, not its total.
//
// Pure (no I/O): the server loader (statement-invoice-hints-server.ts) reads the owner's invoices, this decides what to say.

import { balanceDue } from "./payment-form.ts";

/** One unpaid invoice, reduced to what the hint needs (this is what travels to the browser). */
export interface UnpaidInvoice {
  id: string;
  /** "INV-1004" */
  number: string;
  client_name: string;
  issue_date: string;
  balance_due: number;
}

export interface InvoiceRow {
  id: string;
  type: string;
  status: string;
  document_number: number;
  issue_date: string;
  total_amount: number;
  client: { name: string | null; is_sample?: boolean | null } | null;
  payments: { amount: number }[] | null;
}

const EPSILON = 0.005;
const cents = (n: number) => Math.round(n * 100);

/**
 * The invoices still owed money: type invoice, status sent or partial (a draft is not issued yet and a paid one owes
 * nothing; there is no voided status), a real balance due left, and not the demo client's. Payments are signed, so a
 * refund row raises the balance again exactly as it does on the invoice.
 */
export function unpaidInvoicesFrom(rows: InvoiceRow[]): UnpaidInvoice[] {
  const out: UnpaidInvoice[] = [];
  for (const r of rows) {
    if (r.type !== "invoice" || (r.status !== "sent" && r.status !== "partial")) continue;
    if (r.client?.is_sample) continue;
    const due = balanceDue({ total_amount: r.total_amount, payments: r.payments ?? [] });
    if (due <= EPSILON) continue;
    out.push({
      id: r.id,
      number: `INV-${r.document_number}`,
      client_name: r.client?.name?.trim() || "No client",
      issue_date: r.issue_date,
      balance_due: due,
    });
  }
  return out;
}

export interface HintLine {
  kind: string;
  amount: number;
  txn_date: string;
}

/**
 * A genuine deposit: money in (negative, the card's sign) that is still a payment-kind line. A line the owner moved to
 * another kind is not one, and a payment-kind line with a POSITIVE amount is a transfer or loan principal (money out).
 */
export function isDeposit(line: Pick<HintLine, "kind" | "amount">): boolean {
  return line.kind === "payment" && line.amount < 0;
}

export function depositCount(lines: Pick<HintLine, "kind" | "amount">[], accountType: string | null | undefined): number {
  return accountType === "card" ? 0 : lines.filter(isDeposit).length;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The banner above the money-in group, or null (a card, no deposits, or no unpaid invoices). */
export function depositsBanner(
  lines: Pick<HintLine, "kind" | "amount">[],
  accountType: string | null | undefined,
  unpaid: UnpaidInvoice[],
): string | null {
  const n = depositCount(lines, accountType);
  if (n === 0 || unpaid.length === 0) return null;
  return `This statement has ${plural(n, "deposit")} and you have ${plural(unpaid.length, "unpaid invoice")}. Check whether any were paid.`;
}

export type DepositHint = { kind: "one"; invoice: UnpaidInvoice } | { kind: "many"; count: number };

/**
 * An unpaid invoice whose balance due equals this deposit to the cent AND was issued on or before the deposit date.
 * Exactly one -> name it; two or more -> say how many; none -> nothing. Never a card, never a non-deposit line.
 */
export function depositHint(
  line: HintLine,
  accountType: string | null | undefined,
  unpaid: UnpaidInvoice[],
): DepositHint | null {
  if (accountType === "card" || !isDeposit(line)) return null;
  const want = cents(-line.amount);
  const matches = unpaid.filter((i) => cents(i.balance_due) === want && i.issue_date <= line.txn_date);
  if (matches.length === 0) return null;
  return matches.length === 1 ? { kind: "one", invoice: matches[0] } : { kind: "many", count: matches.length };
}

export const UNPAID_INVOICES_HREF = "/dashboard/invoices";
