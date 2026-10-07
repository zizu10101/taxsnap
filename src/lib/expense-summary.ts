import {
  deductiblePct,
  isCalculated,
  itcPct,
  MEALS_ITC_RESTRICTION_RATE,
  needsTaxCode,
  type TaxedRow,
} from "./tax-codes.ts";

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
export interface ExpenseLineInput extends TaxedRow {
  total_amount: number;
  tax_amount: number;
  tax_category: string;
}

export interface ExpenseSummary {
  totalExpenses: number;
  deductibleSpend: number;
  /** Confirmed + calculated. */
  estHstReclaimable: number;
  /** The part backed by a receipt (or entered by the owner). */
  estHstConfirmed: number;
  /** The part CALCULATED from a card statement with no receipt attached yet. */
  estHstCalculated: number;
  /** Statement expenses with no receipt carrying a calculated figure. */
  calculatedCount: number;
  /** Statement expenses with no receipt and no tax code: nothing was calculated for them. */
  needsTaxCodeCount: number;
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
// The category-only rate: what a row with no tax code of its own is read with. A row that has a
// code (a card-statement expense) is read with deductiblePct()/itcPct() instead, which fall back to
// this when the row carries none - so every receipt from before tax codes is unchanged.
export function deductibleRate(taxCategory: string): number {
  return taxCategory === "Meals" ? MEALS_ITC_RESTRICTION_RATE : 1;
}

export function computeExpenseSummary(receipts: ExpenseLineInput[]): ExpenseSummary {
  const totalExpenses = receipts.reduce((sum, r) => sum + r.total_amount, 0);
  const deductibleSpend = receipts.reduce((sum, r) => sum + r.total_amount * deductiblePct(r), 0);
  // ITC read per row (its own code, else the category), kept in two parts so reports can show what
  // is backed by a receipt separately from what was calculated from a statement.
  let confirmed = 0;
  let calculated = 0;
  let calculatedCount = 0;
  let needsCodeCount = 0;
  for (const r of receipts) {
    const itc = r.tax_amount * itcPct(r);
    if (isCalculated(r)) {
      calculated += itc;
      calculatedCount += 1;
      if (needsTaxCode(r)) needsCodeCount += 1;
    } else {
      confirmed += itc;
    }
  }
  const estHstReclaimable = confirmed + calculated;

  return {
    totalExpenses: round2(totalExpenses),
    deductibleSpend: round2(deductibleSpend),
    estHstReclaimable: round2(estHstReclaimable),
    estHstConfirmed: round2(confirmed),
    estHstCalculated: round2(calculated),
    calculatedCount,
    needsTaxCodeCount: needsCodeCount,
    // Not clamped to 0 - deductibleSpend can never exceed totalExpenses
    // given every deductible share is <= 1, so this is never negative in
    // practice, but computed the same way as every other subtraction here
    // rather than assumed.
    nonDeductibleSpend: round2(totalExpenses - deductibleSpend),
  };
}
