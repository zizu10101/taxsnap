import type { InvoiceDocument, Payment } from "./database.types";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

type RevenueDocument = Pick<InvoiceDocument, "type" | "subtotal" | "total_amount"> & {
  payments: Pick<Payment, "amount">[];
};

// Recognizes a job's invoiced revenue the same way hst-summary-card.tsx
// recognizes revenue for the HST Return Helper: pro-rated per payment
// actually received, not an invoice's full total or its "paid" status - a
// $500 deposit on a $1,000 invoice is $500 of recognized job revenue the
// moment it's received, not $0 until the invoice is fully paid (possibly
// after the job page is checked). Estimates never count, only invoices.
// excluded_from_hst is deliberately ignored here - that flag only opts an
// invoice out of the HST Return Helper's totals, it doesn't mean the money
// wasn't really received for this job.
export function calculateJobRevenue(documents: RevenueDocument[]): number {
  let total = 0;
  for (const doc of documents) {
    if (doc.type !== "invoice" || doc.total_amount <= 0) continue;
    const fraction = doc.subtotal / doc.total_amount;
    for (const payment of doc.payments) {
      total += fraction * payment.amount;
    }
  }
  return round2(total);
}
