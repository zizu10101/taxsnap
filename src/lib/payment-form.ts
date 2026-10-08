// Pure logic behind the invoice payment form (PaymentForm), shared by the invoice
// detail page and the "Record payment" dialog on the Invoices preview panel.

export interface PaymentLike {
  amount: number;
}

export interface PayableDocument {
  type: string;
  total_amount: number;
  payments: PaymentLike[];
}

/** The one name of the "pay the rest" action, on the invoice page and on the preview panel. */
export const COLLECT_BALANCE_LABEL = "Collect remaining balance";

const EPSILON = 0.005;

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function paidToDate(payments: PaymentLike[]): number {
  return round2(payments.reduce((sum, p) => sum + p.amount, 0));
}

/** What is still owed: total minus payments, never below zero. */
export function balanceDue(doc: Pick<PayableDocument, "total_amount" | "payments">): number {
  return Math.max(round2(doc.total_amount - paidToDate(doc.payments)), 0);
}

/**
 * Whether "Record payment" / "Collect remaining balance" is offered: only an
 * invoice (an estimate takes no payments) that still has a balance (a fully
 * paid one has nothing left to collect).
 */
export function canRecordPayment(doc: PayableDocument): boolean {
  return doc.type === "invoice" && balanceDue(doc) > EPSILON;
}

/** The amount "Collect remaining balance" puts in the form: the whole unpaid balance, in cents. */
export function prefillBalanceAmount(doc: Pick<PayableDocument, "total_amount" | "payments">): number {
  return balanceDue(doc);
}

export function percentToAmount(percent: number, total: number): number {
  return round2((percent / 100) * total);
}

function usd(amount: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

export type PaymentAmountCheck = { amount: number; error: null } | { amount: number; error: string };

/**
 * Same checks the form always made before sending, in one place. `effectiveBalance` is the
 * balance PLUS the payment being edited (its own old amount is not "already paid" for this check).
 * The server re-checks all of it; this is for instant feedback.
 */
export function checkPaymentAmount(input: {
  mode: "dollar" | "percent";
  amount: number;
  percent: number;
  total: number;
  effectiveBalance: number;
}): PaymentAmountCheck {
  const amount = input.mode === "percent" ? percentToAmount(input.percent, input.total) : input.amount;
  if (!(amount > 0)) {
    return {
      amount,
      error:
        input.mode === "percent"
          ? "Enter a percentage greater than 0%."
          : "Enter a payment amount greater than $0.",
    };
  }
  if (amount > input.effectiveBalance + 0.001) {
    const over = amount - input.effectiveBalance;
    return {
      amount,
      error: `This payment would exceed the invoice total by ${usd(over)} — edit the invoice or adjust the payment amount.`,
    };
  }
  return { amount, error: null };
}

/**
 * The payments API answers with the document minus its line items; fold that into the copy the
 * screen already holds (which has the items), so paid amount, balance and status all update
 * without a reload.
 */
export function mergeUpdatedDocument<T extends { items: unknown }>(
  current: T,
  updated: Partial<T>,
): T {
  return { ...current, ...updated, items: current.items };
}
