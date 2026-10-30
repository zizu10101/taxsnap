import type { ReadDb } from "@/lib/scoped-reader";
import { recognizePayments } from "@/lib/payment-revenue";
import { computeExpenseSummary, type ExpenseSummary } from "@/lib/expense-summary";
import { deductiblePct } from "@/lib/tax-codes";
import { loadOverviewReceipts, type LoadedOverviewReceipts } from "@/lib/overview-rows";
import { selectAll } from "@/lib/select-all";

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
  // Same totals as the top-level ExpenseSummary fields, just split by
  // whether the receipt has a job_id - the same nullable column job
  // costing already reads. Always sums back to the top-level totals
  // (every receipt is either job-tagged or overhead, never both/neither).
  jobExpenses: ExpenseSummary;
  overheadExpenses: ExpenseSummary;
  trendPoints: ExpenseTrendPoint[];
  salesTrendPoints: SalesTrendPoint[];
  /**
   * More than 20,000 expenses (or invoices) were involved: only the first 20,000 were read, so some
   * totals may be incomplete. Always false below that - every row is read, not just the first 1000.
   */
  truncated: boolean;
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
//
// `loaded` is the range's expense rows when the caller already has them (the Reports page loads them once
// and hands the SAME rows to this function and to its own tables, so the P&L and the category tables are
// built from one row set and always agree). Without it the rows are loaded here.
export async function getExpenseOverviewData(
  supabase: ReadDb,
  from: string | null,
  to: string | null,
  loaded?: LoadedOverviewReceipts,
): Promise<ExpenseOverviewData> {
  // Every expense in the range, not just the first 1000 (see lib/select-all.ts). The rows carry the columns
  // that say whether an expense's tax is CALCULATED (a card-statement expense with no receipt) or
  // confirmed, and the tax code it carries (0057).
  const receiptsLoad = loaded ?? (await loadOverviewReceipts(supabase, from, to));

  // Total Sales deliberately only covers paid invoices, not manual cash-
  // sales entries (the `sales` table) - see expense-overview-query.ts's
  // module comment history / the Overview planning discussion: `sales` is
  // keyed by a free-text period_label with no real date column, so it
  // can't be reliably scoped to an arbitrary day/week/custom range the way
  // payments.paid_date can. No toggle for this - it's a fixed, understood
  // scope, not a partial result masquerading as complete.
  // Every invoice (no date range here: a payment in the range can belong to an older invoice), all pages.
  const documentsLoad = await selectAll(() =>
    supabase
      .from("documents")
      .select("subtotal, total_amount, excluded_from_hst, payments(amount, paid_date)")
      .eq("type", "invoice")
      .order("id", { ascending: true }),
  );
  const documents = documentsLoad.rows;

  const receiptRows = receiptsLoad.rows;

  // Revenue recognition (pro-rated per payment, by received date, honoring
  // excluded_from_hst) lives in lib/payment-revenue.ts so the Reports page
  // uses the identical rule.
  const { totalSales, payments: recognized } = recognizePayments(documents ?? [], from, to);
  const salesTrendPoints: SalesTrendPoint[] = recognized.map((p) => ({
    paidDate: p.paidDate,
    subtotalAmount: p.subtotalAmount,
  }));

  const summary = computeExpenseSummary(receiptRows);
  const jobExpenses = computeExpenseSummary(receiptRows.filter((r) => r.job_id));
  const overheadExpenses = computeExpenseSummary(receiptRows.filter((r) => !r.job_id));

  return {
    ...summary,
    totalSales,
    estProfit: round2(totalSales - summary.totalExpenses),
    jobExpenses,
    overheadExpenses,
    // Minimal per-receipt/per-payment points for the trend chart - summed
    // into day/week/month buckets client-side (see
    // lib/expense-overview.ts), same convention as Commission Overview's
    // own trendPoints.
    trendPoints: receiptRows.map((r) => ({
      transactionDate: r.transaction_date,
      totalAmount: r.total_amount,
      deductibleAmount: r.total_amount * deductiblePct(r),
    })),
    salesTrendPoints,
    truncated: receiptsLoad.truncated || documentsLoad.truncated,
  };
}
