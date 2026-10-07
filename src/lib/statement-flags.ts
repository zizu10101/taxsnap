// The badge shown on an expense that a card-statement import created and no receipt backs yet. Pure
// so the Expenses list, the detail drawer and the tests share one wording.
//
// Two states, which are what the reports split on:
//   "Tax calculated from statement"   a tax code was applied, so the tax (and its ITC) is a
//                                     calculation, not a figure from a receipt
//   "No receipt, needs a tax code"    no code applied, so nothing was calculated: tax 0, no ITC
// Attaching a receipt replaces either with the receipt's actual figure and clears the badge.

import { needsTaxCode } from "./tax-codes.ts";

export interface FlagInput {
  no_receipt?: boolean | null;
  total_amount: number;
  tax_amount: number;
  /** null/absent = no tax code on the row. */
  tax_rate?: number | null;
}

export type FlagTone = "needs_code" | "calculated" | "info";

export interface ExpenseFlag {
  label: string;
  tone: FlagTone;
}

export const NEEDS_CODE_LABEL = "No receipt, needs a tax code";
export const CALCULATED_LABEL = "Tax calculated from statement";

export function statementExpenseFlag(r: FlagInput): ExpenseFlag | null {
  if (!r.no_receipt) return null;
  const needsCode = needsTaxCode({
    from_statement: true,
    no_receipt: true,
    tax_rate: r.tax_rate ?? null,
    tax_amount: r.tax_amount,
  });
  if (r.total_amount < 0) {
    if (needsCode) return { label: "Refund, no receipt, needs a tax code", tone: "needs_code" };
    // A code was applied (calculated, reversing the ITC) or the owner typed the slip's figure.
    return r.tax_rate != null
      ? { label: "Refund, tax calculated from statement", tone: "calculated" }
      : { label: "Refund, no receipt", tone: "info" };
  }
  return needsCode
    ? { label: NEEDS_CODE_LABEL, tone: "needs_code" }
    : { label: CALCULATED_LABEL, tone: "calculated" };
}
