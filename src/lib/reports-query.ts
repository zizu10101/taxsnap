import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getExpenseOverviewData } from "@/lib/expense-overview-query";
import { recognizePayments } from "@/lib/payment-revenue";
import { buildJobCostSummaries } from "@/lib/job-revenue";
import { TAX_CATEGORIES } from "@/lib/tax-categories";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Exactly Overview's Total Sales / Total Expenses / Est. Profit for the same
// range - taken from getExpenseOverviewData itself, not recomputed, so the two
// pages can't show different profit numbers.
export interface ProfitAndLoss {
  // Pre-tax payments received in the range (pro-rated per payment, by
  // received date, honoring excluded_from_hst).
  revenue: number;
  // Receipts' total_amount as paid, HST included - Overview's Total Expenses.
  // Labor cost is not included (job costing only, see the Job Summary).
  expenses: number;
  netProfit: number;
}

export interface CategoryRow {
  category: string;
  count: number;
  // total_amount minus tax_amount, and total_amount as paid.
  preTax: number;
  total: number;
  // False for built-in categories; true for owner-added ones (shown with a
  // marker). Also true for a category whose custom definition was removed.
  isCustom: boolean;
}

export interface ReportsData {
  pnl: ProfitAndLoss;
  categories: CategoryRow[];
}

export interface JobSummaryRow {
  // null for the "Not linked to a job" reconciliation row.
  jobId: string | null;
  name: string;
  revenue: number;
  expenses: number;
  labor: number;
  totalCost: number;
  profit: number;
  invoiceCount: number;
}

export interface JobSummaryData {
  jobs: JobSummaryRow[];
  // Payments and receipts with no job, so the rows add up to the P&L's
  // revenue and expenses exactly. null when there's nothing unlinked.
  unlinked: JobSummaryRow | null;
}

// Shared by GET /api/reports and the Reports page's own initial render.
// RLS scopes every query to the caller's rows; the caller does its own
// Pro/auth check. `from`/`to` are plain inclusive local "YYYY-MM-DD"
// strings (receipts.transaction_date and payments.paid_date are `date`
// columns - same convention as getExpenseOverviewData).
export async function getReportsData(
  supabase: SupabaseClient<Database>,
  from: string | null,
  to: string | null,
): Promise<ReportsData> {
  let receiptsQuery = supabase
    .from("receipts")
    .select("total_amount, tax_amount, tax_category");
  if (from) receiptsQuery = receiptsQuery.gte("transaction_date", from);
  if (to) receiptsQuery = receiptsQuery.lte("transaction_date", to);

  const [overview, { data: receipts }, { data: customCategories }] = await Promise.all([
    getExpenseOverviewData(supabase, from, to),
    receiptsQuery,
    supabase.from("expense_categories").select("name"),
  ]);

  const pnl: ProfitAndLoss = {
    revenue: overview.totalSales,
    expenses: overview.totalExpenses,
    netProfit: overview.estProfit,
  };

  // Grouped case-insensitively onto the canonical spelling (a built-in's, else
  // the custom category's) so "meals" and "Meals" never split into two rows.
  // A category with spend always appears, even if it has since been
  // deactivated or removed; one with no spend in the range does not.
  const canonical = new Map<string, string>();
  for (const c of TAX_CATEGORIES) canonical.set(c.toLowerCase(), c);
  for (const c of customCategories ?? []) {
    const key = c.name.trim().toLowerCase();
    if (!canonical.has(key)) canonical.set(key, c.name.trim());
  }
  const grouped = new Map<string, CategoryRow>();
  for (const r of receipts ?? []) {
    const key = categoryKey(r.tax_category);
    const row = grouped.get(key) ?? {
      category: canonical.get(key) ?? (r.tax_category?.trim() || "Other"),
      count: 0,
      preTax: 0,
      total: 0,
      isCustom: !TAX_CATEGORIES.some((c) => c.toLowerCase() === key),
    };
    row.count += 1;
    row.preTax += r.total_amount - r.tax_amount;
    row.total += r.total_amount;
    grouped.set(key, row);
  }
  const categories = [...grouped.values()]
    .map((r) => ({ ...r, preTax: round2(r.preTax), total: round2(r.total) }))
    .sort((a, b) => b.total - a.total);

  return { pnl, categories };
}

// Same normalization the grouping above uses, shared with the drill-down so a
// category's expanded receipts are exactly the ones counted in its total.
function categoryKey(taxCategory: string | null | undefined): string {
  return (taxCategory?.trim() || "Other").toLowerCase();
}

// Per-job rollup over an optional date range (null/null = all time, the
// default). Revenue is payments *received* in the range (pro-rated, honoring
// excluded_from_hst - the P&L's rule), expenses are receipts by transaction
// date, labor is hours by work date. Jobs with no activity in a ranged report
// are left out. Profit here is revenue - expenses - labor.
// Job Costing's own pages stay all-time on purpose; this is Reports only.
export async function getJobSummary(
  supabase: SupabaseClient<Database>,
  from: string | null,
  to: string | null,
): Promise<JobSummaryData> {
  const ranged = !!(from || to);

  let receiptsQuery = supabase.from("receipts").select("job_id, total_amount");
  if (from) receiptsQuery = receiptsQuery.gte("transaction_date", from);
  if (to) receiptsQuery = receiptsQuery.lte("transaction_date", to);

  let hoursQuery = supabase
    .from("hour_entries")
    .select("job_id, labor_cost, labor_revenue");
  if (from) hoursQuery = hoursQuery.gte("work_date", from);
  if (to) hoursQuery = hoursQuery.lte("work_date", to);

  const [overview, { data: jobs }, { data: receipts }, { data: hourEntries }, { data: documents }] =
    await Promise.all([
      // The P&L's own revenue/expenses for this range - the unlinked row is
      // whatever is left after the jobs, so the footer ties to it exactly.
      getExpenseOverviewData(supabase, from, to),
      supabase.from("jobs").select("id, name").order("name", { ascending: true }),
      receiptsQuery,
      hoursQuery,
      supabase
        .from("documents")
        .select("job_id, type, subtotal, total_amount, excluded_from_hst, payments(amount, paid_date)")
        .not("job_id", "is", null),
    ]);

  // Only payments received in the range count toward a job's revenue; the
  // invoice stays linked (and counted) either way.
  const rangedDocuments = (documents ?? []).map((d) => ({
    ...d,
    payments: d.payments.filter(
      (p) => (!from || p.paid_date >= from) && (!to || p.paid_date <= to),
    ),
  }));

  const linkedReceipts = (receipts ?? []).filter((r) => r.job_id);
  const summaries = buildJobCostSummaries(
    (jobs ?? []).map((j) => j.id),
    linkedReceipts,
    hourEntries ?? [],
    rangedDocuments,
    // Same revenue rule as the P&L: invoices excluded from HST are out.
    { honorExcludedFromHst: true },
  );

  const allRows: JobSummaryRow[] = (jobs ?? []).map((j) => {
    const s = summaries.get(j.id)!;
    return {
      jobId: j.id,
      name: j.name,
      revenue: s.jobRevenue,
      expenses: s.totalExpenses,
      labor: s.totalLaborCost,
      totalCost: s.totalJobCost,
      profit: s.estProfit,
      invoiceCount: s.linkedInvoiceCount,
    };
  });

  const linkedRevenue = allRows.reduce((sum, r) => sum + r.revenue, 0);
  const linkedExpenses = allRows.reduce((sum, r) => sum + r.expenses, 0);
  const unlinkedRevenue = round2(overview.totalSales - linkedRevenue);
  const unlinkedExpenses = round2(overview.totalExpenses - linkedExpenses);
  const hasUnlinked = Math.abs(unlinkedRevenue) >= 0.005 || Math.abs(unlinkedExpenses) >= 0.005;

  const unlinked: JobSummaryRow | null = hasUnlinked
    ? {
        jobId: null,
        name: "Not linked to a job",
        revenue: unlinkedRevenue,
        expenses: unlinkedExpenses,
        labor: 0,
        totalCost: unlinkedExpenses,
        profit: round2(unlinkedRevenue - unlinkedExpenses),
        invoiceCount: 0,
      }
    : null;

  const rows = ranged
    ? allRows.filter((r) => r.revenue !== 0 || r.expenses !== 0 || r.labor !== 0)
    : allRows;

  return { jobs: rows, unlinked };
}

export interface RevenueDetailRow {
  paymentId: string;
  paidDate: string;
  documentId: string;
  documentNumber: number;
  clientName: string;
  depositedTo: string | null;
  // The payment as received, and the pre-tax part of it that counts as revenue.
  amount: number;
  revenue: number;
}

export interface ExpenseDetailRow {
  id: string;
  date: string;
  merchant: string;
  category: string;
  job: string | null;
  // Name of the account/card the expense was paid with, if one was chosen.
  paidWith: string | null;
  amount: number;
}

// Drill-down rows behind the P&L's revenue line: the same recognizePayments
// pass Overview and the P&L use, so the rows add up to the figure shown.
export async function getRevenueDetail(
  supabase: SupabaseClient<Database>,
  from: string | null,
  to: string | null,
): Promise<{ rows: RevenueDetailRow[]; total: number }> {
  const [{ data: documents, error: documentsError }, { data: bankAccounts }] = await Promise.all([
    supabase
      .from("documents")
      .select(
        "id, document_number, subtotal, total_amount, excluded_from_hst, client:clients(name), payments(id, amount, paid_date, bank_account_id)",
      )
      .eq("type", "invoice"),
    supabase.from("bank_accounts").select("id, name"),
  ]);
  // An error must not read as "no payments in this range" - the route turns a
  // throw into a 500 and the panel shows "Couldn't load these rows".
  if (documentsError) throw new Error(documentsError.message);
  const bankNames = new Map((bankAccounts ?? []).map((a) => [a.id, a.name]));

  const { totalSales, payments } = recognizePayments(documents ?? [], from, to);
  const rows = payments
    .map((p) => ({
      paymentId: p.payment.id,
      paidDate: p.paidDate,
      documentId: p.doc.id,
      documentNumber: p.doc.document_number,
      clientName: p.doc.client?.name ?? "—",
      depositedTo: p.payment.bank_account_id
        ? (bankNames.get(p.payment.bank_account_id) ?? null)
        : null,
      amount: p.payment.amount,
      revenue: p.subtotalAmount,
    }))
    .sort((a, b) => (a.paidDate < b.paidDate ? 1 : a.paidDate > b.paidDate ? -1 : 0));

  return { rows, total: totalSales };
}

// Drill-down receipts behind the P&L's expenses line (no `category`) or one
// row of Expenses by Category (`category`, matched the way that report groups
// it - case-insensitively). Amounts are as paid, HST included, so they add up
// to Overview's Total Expenses / the category's Total paid.
export async function getExpenseDetail(
  supabase: SupabaseClient<Database>,
  from: string | null,
  to: string | null,
  category?: string,
): Promise<{ rows: ExpenseDetailRow[]; total: number }> {
  let query = supabase
    .from("receipts")
    .select(
      "id, transaction_date, merchant_name, tax_category, job_name, total_amount, paid_with_account_id",
    )
    .order("transaction_date", { ascending: false });
  if (from) query = query.gte("transaction_date", from);
  if (to) query = query.lte("transaction_date", to);

  const [{ data, error }, { data: accounts }] = await Promise.all([
    query,
    supabase.from("bank_accounts").select("id, name"),
  ]);
  if (error) throw new Error(error.message);
  const accountNames = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const wanted = category !== undefined ? categoryKey(category) : null;
  const rows = (data ?? [])
    .filter((r) => wanted === null || categoryKey(r.tax_category) === wanted)
    .map((r) => ({
      id: r.id,
      date: r.transaction_date,
      merchant: r.merchant_name,
      category: r.tax_category,
      job: r.job_name,
      paidWith: r.paid_with_account_id ? (accountNames.get(r.paid_with_account_id) ?? null) : null,
      amount: r.total_amount,
    }));

  return { rows, total: round2(rows.reduce((sum, r) => sum + r.amount, 0)) };
}
