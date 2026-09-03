import { MEALS_ITC_RESTRICTION_RATE } from "@/lib/hst";

// Shared by the Overview page's server-side aggregation
// (expense-overview-query.ts) and the accountant export bundle
// (accountant-export.ts, computed client-side over an already-filtered
// receipts array) - one definition so both always agree, whether the
// input came from a fresh query or receipts already in memory.
//
// Deliberately receipts-only (no revenue/sales data folded in): manual
// sales entries (`sales` table) are keyed by a free-text period_label with
// no real date column, so they can't be reliably scoped to an arbitrary
// day/week/custom range the way receipts.transaction_date can. See
// hst-summary-card.tsx for the one place this app *does* combine receipts
// with revenue - that's a deliberately different, coarser-grained report.
export interface ExpenseLineInput {
  total_amount: number;
  tax_amount: number;
  tax_category: string;
}

export interface ExpenseSummary {
  totalExpenses: number;
  deductibleSpend: number;
  estHstReclaimable: number;
  nonDeductibleSpend: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Meals & entertainment gets the same 50% restriction already established
// in lib/hst.ts for HST ITCs - the Excise Tax Act's 50% meals restriction
// mirrors the income-tax treatment of those expenses, so it's the correct
// rate for expense deductibility too, not just the HST credit. Exported so
// expense-overview-query.ts's trend-chart points use the identical rate
// instead of a second hardcoded 0.5.
export function deductibleRate(taxCategory: string): number {
  return taxCategory === "Meals" ? MEALS_ITC_RESTRICTION_RATE : 1;
}

export function computeExpenseSummary(receipts: ExpenseLineInput[]): ExpenseSummary {
  const totalExpenses = receipts.reduce((sum, r) => sum + r.total_amount, 0);
  const deductibleSpend = receipts.reduce(
    (sum, r) => sum + r.total_amount * deductibleRate(r.tax_category),
    0,
  );
  const estHstReclaimable = receipts.reduce(
    (sum, r) => sum + r.tax_amount * deductibleRate(r.tax_category),
    0,
  );

  return {
    totalExpenses: round2(totalExpenses),
    deductibleSpend: round2(deductibleSpend),
    estHstReclaimable: round2(estHstReclaimable),
    // Not clamped to 0 - deductibleSpend can never exceed totalExpenses
    // given deductibleRate() is always <= 1, so this is never negative in
    // practice, but computed the same way as every other subtraction here
    // rather than assumed.
    nonDeductibleSpend: round2(totalExpenses - deductibleSpend),
  };
}
