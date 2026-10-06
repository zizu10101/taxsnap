// The badge shown on an expense that a card-statement import created. Pure so
// the Expenses list, the detail drawer and the tests share one wording.

export interface FlagInput {
  no_receipt?: boolean | null;
  total_amount: number;
  tax_amount: number;
}

export interface ExpenseFlag {
  label: string;
}

export const NO_RECEIPT_LABEL = "No receipt, ITC not claimed";

export function statementExpenseFlag(r: FlagInput): ExpenseFlag | null {
  if (!r.no_receipt) return null;
  if (r.total_amount < 0) {
    // A refund of a purchase whose HST was already claimed still needs that HST
    // reversed; until a figure is entered it hasn't been.
    return {
      label: r.tax_amount === 0 ? "Refund, no receipt, HST not adjusted" : "Refund, no receipt",
    };
  }
  return { label: NO_RECEIPT_LABEL };
}
