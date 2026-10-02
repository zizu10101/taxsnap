function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface RevenueDocument {
  subtotal: number;
  total_amount: number;
  excluded_from_hst: boolean;
  payments: { amount: number; paid_date: string }[];
}

// `doc` and `payment` are the caller's own rows (whatever extra fields they
// selected - invoice id/number, client, bank account), handed back so a
// drill-down can list exactly the payments that make up the total.
export interface RecognizedPayment<D extends RevenueDocument = RevenueDocument> {
  paidDate: string; // YYYY-MM-DD
  subtotalAmount: number;
  taxAmount: number;
  doc: D;
  payment: D["payments"][number];
}

// The one place the "revenue" rule lives for the Overview and Reports pages:
// each payment is pro-rated into its invoice's pre-tax subtotal and counted
// in the period it was actually *received* (not when the invoice was issued
// or fully paid), and invoices excluded from the HST Return Helper stay
// excluded - identical to the HST helper's own recognizedPayments
// (hst-summary-card.tsx), just computed server-side. `from`/`to` are plain
// inclusive local "YYYY-MM-DD" strings, either may be null (unbounded),
// matching payments.paid_date's `date` column.
export function recognizePayments<D extends RevenueDocument>(
  documents: D[],
  from: string | null,
  to: string | null,
): { totalSales: number; hstCollected: number; payments: RecognizedPayment<D>[] } {
  const payments: RecognizedPayment<D>[] = [];
  let totalSales = 0;
  let hstCollected = 0;

  for (const doc of documents) {
    if (doc.excluded_from_hst) continue;
    const fraction = doc.total_amount > 0 ? doc.subtotal / doc.total_amount : 0;
    for (const payment of doc.payments) {
      if (from && payment.paid_date < from) continue;
      if (to && payment.paid_date > to) continue;
      const subtotalAmount = round2(fraction * payment.amount);
      const taxAmount = round2(payment.amount - subtotalAmount);
      totalSales += subtotalAmount;
      hstCollected += taxAmount;
      payments.push({ paidDate: payment.paid_date, subtotalAmount, taxAmount, doc, payment });
    }
  }

  return { totalSales: round2(totalSales), hstCollected: round2(hstCollected), payments };
}
