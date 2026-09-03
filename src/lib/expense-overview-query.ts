import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { computeExpenseSummary, deductibleRate, type ExpenseSummary } from "@/lib/expense-summary";

export interface ExpenseTrendPoint {
  transactionDate: string; // YYYY-MM-DD
  totalAmount: number;
  deductibleAmount: number;
}

export interface SalesTrendPoint {
  paidDate: string; // YYYY-MM-DD
  subtotalAmount: number;
}

export interface ExpenseOverviewData extends ExpenseSummary {
  totalSales: number;
  // Sales minus expenses - not a real net-income figure (no cost of goods,
  // payroll, etc. factored in), just what the two numbers already on this
  // page net to. See totalSales' own comment for what "sales" means here.
  estProfit: number;
  trendPoints: ExpenseTrendPoint[];
  salesTrendPoints: SalesTrendPoint[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// General-business analogue of getCommissionOverviewData - shared between
// GET /api/expenses/overview and the Overview page's own initial server
// render, so the two call sites can't drift. RLS scopes every query to the
// caller's own receipts/documents, same as every sibling route - no
// explicit ownership filter needed here either. Caller is responsible for
// its own auth/tier check (requireProUser for the API route, the page's
// own profile fetch for SSR).
//
// Filters on transaction_date, not created_at - matches how every other
// receipts view in this app (filterByRange's default field, the HST
// calculator's own receipts prop) already scopes "the period" a receipt
// belongs to, so this Overview can't disagree with the rest of the
// dashboard about which receipts fall in a given range.
//
// `from`/`to` are plain local "YYYY-MM-DD" strings, both inclusive - the
// same convention getPresetRange/filterByRange already use everywhere
// else for this column. Deliberately NOT rangeToUtcBounds()'s UTC-instant
// convention: that exists for timestamptz columns (commission_entries.
// created_at) where a bare date string is ambiguous against the
// database's session timezone. transaction_date/payments.paid_date are
// plain `date` columns with no time component, so converting them through
// a UTC instant first would risk the exact off-by-one-day bug date-range.
// ts's own comments warn about, for no benefit here.
export async function getExpenseOverviewData(
  supabase: SupabaseClient<Database>,
  from: string | null,
  to: string | null,
): Promise<ExpenseOverviewData> {
  let receiptsQuery = supabase
    .from("receipts")
    .select("transaction_date, total_amount, tax_amount, tax_category")
    .order("transaction_date", { ascending: true });
  if (from) receiptsQuery = receiptsQuery.gte("transaction_date", from);
  if (to) receiptsQuery = receiptsQuery.lte("transaction_date", to);

  // Total Sales deliberately only covers paid invoices, not manual cash-
  // sales entries (the `sales` table) - see expense-overview-query.ts's
  // module comment history / the Overview planning discussion: `sales` is
  // keyed by a free-text period_label with no real date column, so it
  // can't be reliably scoped to an arbitrary day/week/custom range the way
  // payments.paid_date can. No toggle for this - it's a fixed, understood
  // scope, not a partial result masquerading as complete.
  const documentsQuery = supabase
    .from("documents")
    .select("subtotal, total_amount, excluded_from_hst, payments(amount, paid_date)")
    .eq("type", "invoice");

  const [{ data: receipts }, { data: documents }] = await Promise.all([
    receiptsQuery,
    documentsQuery,
  ]);

  const receiptRows = receipts ?? [];

  // Pro-rates each payment into its invoice's pre-tax subtotal and counts
  // it in the period it was actually *received*, not when the invoice was
  // issued or fully paid off - identical revenue-recognition rule to the
  // HST Return Helper's own recognizedPayments (hst-summary-card.tsx),
  // just computed server-side here instead of client-side there. Also
  // respects excluded_from_hst, same as that calculator's Line 101 - an
  // invoice already excluded there (e.g. a reimbursement) shouldn't
  // silently count as sales here either, or the two "total sales" figures
  // in this app could disagree for a reason invisible in the UI.
  let totalSales = 0;
  const salesTrendPoints: SalesTrendPoint[] = [];
  for (const doc of documents ?? []) {
    if (doc.excluded_from_hst) continue;
    const fraction = doc.total_amount > 0 ? doc.subtotal / doc.total_amount : 0;
    for (const payment of doc.payments) {
      if (from && payment.paid_date < from) continue;
      if (to && payment.paid_date > to) continue;
      const subtotalPortion = round2(fraction * payment.amount);
      totalSales += subtotalPortion;
      salesTrendPoints.push({ paidDate: payment.paid_date, subtotalAmount: subtotalPortion });
    }
  }
  totalSales = round2(totalSales);

  const summary = computeExpenseSummary(receiptRows);

  return {
    ...summary,
    totalSales,
    estProfit: round2(totalSales - summary.totalExpenses),
    // Minimal per-receipt/per-payment points for the trend chart - summed
    // into day/week/month buckets client-side (see
    // lib/expense-overview.ts), same convention as Commission Overview's
    // own trendPoints.
    trendPoints: receiptRows.map((r) => ({
      transactionDate: r.transaction_date,
      totalAmount: r.total_amount,
      deductibleAmount: r.total_amount * deductibleRate(r.tax_category),
    })),
    salesTrendPoints,
  };
}
