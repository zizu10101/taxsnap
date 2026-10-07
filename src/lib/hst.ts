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

// Defined in tax-codes.ts (the one home for the three tax-code numbers) and re-exported here so
// every existing importer keeps working. ITCs on most meals & entertainment purchases are
// restricted to 50% by the Excise Tax Act, mirroring the income tax treatment.
export { MEALS_ITC_RESTRICTION_RATE, ONTARIO_HST_RATE } from "./tax-codes.ts";

import { isCalculated, itcPct, needsTaxCode, ONTARIO_HST_RATE, round2, type TaxedRow } from "./tax-codes.ts";

export interface HSTReturnLines {
  /** Line 101 - Total sales and other revenue for the period. */
  line101: number;
  /** Line 103 - GST/HST collected or collectible. */
  line103: number;
  /** Line 106 - Input tax credits (ITCs) claimable on business purchases. */
  line106: number;
  /** Line 106's two parts, always both reported: ITCs backed by a receipt (or entered by the
   *  owner), and ITCs CALCULATED from a card statement with no receipt yet. line106 is the
   *  confirmed part plus the calculated part when includeCalculated is on. */
  line106Confirmed: number;
  line106Calculated: number;
  /** Statement expenses with no receipt AND no tax code: nothing was calculated for them. */
  needsTaxCodeCount: number;
  /** How many statement expenses with no receipt carry a calculated figure. */
  calculatedCount: number;
  /** Line 109 - Net tax: positive means owed to the CRA, negative means a refund. */
  line109: number;
}

export interface PaidInvoiceInput {
  /** Pre-tax revenue from the invoice - what actually counts as a "sale". */
  subtotal: number;
  /** HST already calculated and collected on that invoice at issue time. */
  hst_amount: number;
}

export function calculateHSTReturn(
  manualGrossSales: number,
  paidInvoices: PaidInvoiceInput[],
  receipts: TaxedRow[],
  options: { includeCalculated?: boolean } = {},
): HSTReturnLines {
  const includeCalculated = options.includeCalculated ?? true;
  const invoicedSubtotal = paidInvoices.reduce((sum, i) => sum + i.subtotal, 0);
  // Invoice HST is summed directly from each invoice's own line-item total
  // rather than re-derived at the flat rate, since it's already the actual
  // amount collected (and avoids compounding rounding across invoices).
  const invoicedHst = paidInvoices.reduce((sum, i) => sum + i.hst_amount, 0);

  const line101 = round2(manualGrossSales + invoicedSubtotal);
  const line103 = round2(manualGrossSales * ONTARIO_HST_RATE + invoicedHst);

  // Each row's claim share comes from its own tax code when it has one, else the category (Meals
  // 50%, everything else 100%) exactly as before tax codes existed.
  let confirmed = 0;
  let calculated = 0;
  let calculatedCount = 0;
  let needsCode = 0;
  for (const r of receipts) {
    const itc = r.tax_amount * itcPct(r);
    if (isCalculated(r)) {
      calculated += itc;
      calculatedCount += 1;
      if (needsTaxCode(r)) needsCode += 1;
    } else {
      confirmed += itc;
    }
  }
  const line106 = round2(confirmed + (includeCalculated ? calculated : 0));

  const line109 = round2(line103 - line106);

  return {
    line101,
    line103,
    line106,
    line109,
    line106Confirmed: round2(confirmed),
    line106Calculated: round2(calculated),
    needsTaxCodeCount: needsCode,
    calculatedCount,
  };
}
