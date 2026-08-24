// Ontario GST/HST return planning helper.
//
// This is a *planning estimate* to help a self-employed contractor get a
// rough sense of what they'll owe or be refunded - it is not tax advice and
// is not a substitute for filing. Always verify figures (and current CRA
// line numbers, which can change) with a bookkeeper/accountant before
// submitting a return.
//
// Line numbers below match the CRA GST/HST return as documented at
// https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/calculate-prepare-report/calculate-net-gst-hst.html
// (Line 101 = total sales/revenue, Line 103 = GST/HST collected, Line 106 =
// input tax credits, Line 109 = net tax). Note this deliberately does NOT
// use "Line 107" or "Line 115" - on the real form, 107 is for adjustments
// like bad debts (unrelated to ITCs), and 115 isn't a line on the form at
// all, so those numbers were dropped to avoid mislabeling.

export const ONTARIO_HST_RATE = 0.13;

// The Excise Tax Act restricts ITCs on most meals & entertainment purchases
// to 50%, mirroring the income tax treatment of those expenses.
export const MEALS_ITC_RESTRICTION_RATE = 0.5;

export interface HSTReturnLines {
  /** Line 101 - Total sales and other revenue for the period. */
  line101: number;
  /** Line 103 - GST/HST collected or collectible. */
  line103: number;
  /** Line 106 - Input tax credits (ITCs) claimable on business purchases. */
  line106: number;
  /** Line 109 - Net tax: positive means owed to the CRA, negative means a refund. */
  line109: number;
}

export interface PaidInvoiceInput {
  /** Pre-tax revenue from the invoice - what actually counts as a "sale". */
  subtotal: number;
  /** HST already calculated and collected on that invoice at issue time. */
  hst_amount: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function calculateHSTReturn(
  manualGrossSales: number,
  paidInvoices: PaidInvoiceInput[],
  receipts: { tax_category: string; tax_amount: number }[],
): HSTReturnLines {
  const invoicedSubtotal = paidInvoices.reduce((sum, i) => sum + i.subtotal, 0);
  // Invoice HST is summed directly from each invoice's own line-item total
  // rather than re-derived at the flat rate, since it's already the actual
  // amount collected (and avoids compounding rounding across invoices).
  const invoicedHst = paidInvoices.reduce((sum, i) => sum + i.hst_amount, 0);

  const line101 = round2(manualGrossSales + invoicedSubtotal);
  const line103 = round2(manualGrossSales * ONTARIO_HST_RATE + invoicedHst);

  const line106 = round2(
    receipts.reduce((sum, r) => {
      const eligibleRate =
        r.tax_category === "Meals" ? MEALS_ITC_RESTRICTION_RATE : 1;
      return sum + r.tax_amount * eligibleRate;
    }, 0),
  );

  const line109 = round2(line103 - line106);

  return { line101, line103, line106, line109 };
}
