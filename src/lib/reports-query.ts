import type { ReadDb } from "@/lib/scoped-reader";
import { getExpenseOverviewData } from "@/lib/expense-overview-query";
import { loadOverviewReceipts } from "@/lib/overview-rows";
import { selectAll } from "@/lib/select-all";
import { recognizePayments } from "@/lib/payment-revenue";
import { buildJobCostSummaries } from "@/lib/job-revenue";
import {
  buildExpensesReport,
  NO_VENDOR_KEY,
  type ExpensesReport,
  type ExpensesReportFilters,
} from "@/lib/expenses-report";
import { vendorKey } from "@/lib/merchant-name";
import { canonicalCategory, categoryGroupKey } from "@/lib/tax-categories";
import { buildRevenueReport, type RevenueReport } from "@/lib/revenue-report";
import {
  groupSpendingByAccount,
  matchesAccountFilter,
  type AccountSpendData,
} from "@/lib/account-spending";

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

export interface ReportsData {
  pnl: ProfitAndLoss;
  // Tracked spending per "Paid with" account (incl. a "Not specified" row) -
  // adds up to the P&L's expenses. Not an account balance.
  accounts: AccountSpendData;
  /** More than 20,000 records were involved: only the first 20,000 were counted. */
  truncated: boolean;
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
  /** More than 20,000 records were involved: only the first 20,000 were counted. */
  truncated: boolean;
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
  supabase: ReadDb,
  from: string | null,
  to: string | null,
): Promise<ReportsData> {
  // ONE load of the range's expenses (every row, all pages), handed to the overview totals AND used for the
  // By Account table below: the P&L and the table are built from the very same rows, so they always agree.
  const loaded = await loadOverviewReceipts(supabase, from, to);
  const [overview, { data: accountRows }] = await Promise.all([
    getExpenseOverviewData(supabase, from, to, loaded),
    supabase.from("bank_accounts").select("id, name, account_type, is_active"),
  ]);

  const pnl: ProfitAndLoss = {
    revenue: overview.totalSales,
    expenses: overview.totalExpenses,
    netProfit: overview.estProfit,
  };

  const accounts = groupSpendingByAccount(
    loaded.rows.map((r) => ({
      total_amount: r.total_amount,
      tax_amount: r.tax_amount,
      tax_category: r.tax_category,
      paid_with_account_id: r.paid_with_account_id ?? null,
    })),
    accountRows ?? [],
  );

  return { pnl, accounts, truncated: overview.truncated };
}

// Same normalization the grouping above uses, shared with the drill-down so a
// category's expanded receipts are exactly the ones counted in its total.
function categoryKey(taxCategory: string | null | undefined): string {
  return categoryGroupKey(taxCategory);
}

// Per-job rollup over an optional date range (null/null = all time, the
// default). Revenue is payments *received* in the range (pro-rated, honoring
// excluded_from_hst - the P&L's rule), expenses are receipts by transaction
// date, labor is hours by work date. Jobs with no activity in a ranged report
// are left out. Profit here is revenue - expenses - labor.
// Job Costing's own pages stay all-time on purpose; this is Reports only.
export async function getJobSummary(
  supabase: ReadDb,
  from: string | null,
  to: string | null,
): Promise<JobSummaryData> {
  const ranged = !!(from || to);

  // The range's expenses, loaded once and shared with the overview totals below (same rows as Reports).
  const loaded = await loadOverviewReceipts(supabase, from, to);

  // Every hours entry and every job-linked invoice, all pages.
  const hoursLoad = selectAll(() => {
    let query = supabase.from("hour_entries").select("job_id, labor_cost, labor_revenue");
    if (from) query = query.gte("work_date", from);
    if (to) query = query.lte("work_date", to);
    return query.order("work_date", { ascending: true }).order("id", { ascending: true });
  });
  const documentsLoad = selectAll(() =>
    supabase
      .from("documents")
      .select("job_id, type, subtotal, total_amount, excluded_from_hst, payments(amount, paid_date)")
      .not("job_id", "is", null)
      .order("id", { ascending: true }),
  );

  const [overview, { data: jobs }, hours, documentRows] =
    await Promise.all([
      // The P&L's own revenue/expenses for this range - the unlinked row is
      // whatever is left after the jobs, so the footer ties to it exactly.
      getExpenseOverviewData(supabase, from, to, loaded),
      supabase.from("jobs").select("id, name").eq("is_sample", false).order("name", { ascending: true }),
      hoursLoad,
      documentsLoad,
    ]);
  const receipts = loaded.rows;
  const hourEntries = hours.rows;
  const documents = documentRows.rows;

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

  return { jobs: rows, unlinked, truncated: overview.truncated || hours.truncated || documentRows.truncated };
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
  supabase: ReadDb,
  from: string | null,
  to: string | null,
): Promise<{ rows: RevenueDetailRow[]; total: number }> {
  // Every invoice, all pages. A failed page throws (selectAll never turns an error into "no rows"): the
  // route turns a throw into a 500 and the panel shows "Couldn't load these rows", and an error must not
  // read as "no payments in this range".
  const [{ rows: documents }, { data: bankAccounts }] = await Promise.all([
    selectAll(() =>
      supabase
        .from("documents")
        .select(
          "id, document_number, subtotal, total_amount, excluded_from_hst, client:clients(name), payments(id, amount, paid_date, bank_account_id)",
        )
        .eq("type", "invoice")
        .order("id", { ascending: true }),
    ),
    supabase.from("bank_accounts").select("id, name"),
  ]);
  const bankNames = new Map((bankAccounts ?? []).map((a) => [a.id, a.name]));

  const { totalSales, payments } = recognizePayments(documents, from, to);
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
  supabase: ReadDb,
  from: string | null,
  to: string | null,
  category?: string,
  // An account id, or NOT_SPECIFIED ("none") for expenses with no "Paid with".
  account?: string,
  // A vendor key from the Expenses report (vendorKey of the merchant name).
  vendor?: string,
): Promise<{ rows: ExpenseDetailRow[]; total: number }> {
  // Every expense in the range, all pages (a drill-down must list the rows its total counted).
  const [{ rows: data }, { data: accounts }] = await Promise.all([
    selectAll(() => {
      let query = supabase
        .from("receipts")
        .select(
          "id, transaction_date, merchant_name, tax_category, job_name, total_amount, paid_with_account_id",
        );
      if (from) query = query.gte("transaction_date", from);
      if (to) query = query.lte("transaction_date", to);
      return query.order("transaction_date", { ascending: false }).order("id", { ascending: true });
    }),
    supabase.from("bank_accounts").select("id, name"),
  ]);
  const accountNames = new Map((accounts ?? []).map((a) => [a.id, a.name]));
  const wanted = category !== undefined ? categoryKey(category) : null;
  const rows = data
    .filter((r) => wanted === null || categoryKey(r.tax_category) === wanted)
    .filter((r) => account === undefined || matchesAccountFilter(r.paid_with_account_id, account))
    .filter((r) => vendor === undefined || (vendorKey(r.merchant_name) ?? NO_VENDOR_KEY) === vendor)
    .map((r) => ({
      id: r.id,
      date: r.transaction_date,
      merchant: r.merchant_name,
      category: canonicalCategory(r.tax_category),
      job: r.job_name,
      paidWith: r.paid_with_account_id ? (accountNames.get(r.paid_with_account_id) ?? null) : null,
      amount: r.total_amount,
    }));

  return { rows, total: round2(rows.reduce((sum, r) => sum + r.amount, 0)) };
}

// The Expenses report (by category or by vendor, optional vendor and category
// filters): the same receipts rows the Expenses tab lists (a deleted expense is
// gone from the table, so it is simply not here). Reads only the columns the
// report shows. `userId` adds an explicit user_id filter on top of RLS / the
// accountant's scoped reader.
export async function getExpensesReport(
  supabase: ReadDb,
  userId: string,
  from: string | null,
  to: string | null,
  filters: ExpensesReportFilters = {},
): Promise<ExpensesReport> {
  // Every expense in the range, all pages.
  const [{ rows: data }, { data: customCategories }] = await Promise.all([
    selectAll(() => {
      let query = supabase
        .from("receipts")
        .select("id, merchant_name, transaction_date, tax_category, total_amount, tax_amount")
        .eq("user_id", userId);
      if (from) query = query.gte("transaction_date", from);
      if (to) query = query.lte("transaction_date", to);
      return query.order("transaction_date", { ascending: false }).order("id", { ascending: true });
    }),
    supabase.from("expense_categories").select("name").eq("user_id", userId),
  ]);
  return buildExpensesReport(
    data,
    filters,
    (customCategories ?? []).map((c) => c.name),
  );
}

// Revenue: payments received in the range (see lib/revenue-report.ts). Every
// invoice is read, not just those issued in the range, because a payment in the
// range can belong to an older invoice. Only report columns: no notes, no line items.
export async function getRevenueReport(
  supabase: ReadDb,
  userId: string,
  from: string | null,
  to: string | null,
): Promise<RevenueReport> {
  // Every invoice, all pages (a failed page throws).
  const { rows } = await selectAll(() =>
    supabase
      .from("documents")
      .select(
        "id, document_number, status, issue_date, subtotal, total_amount, excluded_from_hst, client_id, job_id, client:clients(name), job:jobs(name), payments(id, amount, paid_date)",
      )
      .eq("type", "invoice")
      .eq("user_id", userId)
      .order("id", { ascending: true }),
  );
  return buildRevenueReport(rows, from, to);
}
