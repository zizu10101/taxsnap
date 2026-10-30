import type { ReadDb } from "./scoped-reader.ts";
import { selectAll } from "./select-all.ts";

// The expense rows behind the Overview AND the Reports page, loaded ONCE per request by one function so the
// two can never be built from different rows. (They used to run their own queries over the same range:
// each silently stopped at the database's 1000-row page, in a different order, so the P&L and the category
// table could disagree by a few thousand dollars.) getExpenseOverviewData and getReportsData and
// getJobSummary all take the rows from here; getReportsData and getJobSummary load them once and hand the
// same set to the overview totals and to their own tables.
//
// The columns are the union of what those three read: the figures and tax code (Overview), the account an
// expense was paid with (the By Account table) and the job (job costing).
export const OVERVIEW_RECEIPT_COLUMNS =
  "transaction_date, total_amount, tax_amount, tax_category, job_id, paid_with_account_id, from_statement, no_receipt, tax_rate, itc_pct, deductible_pct";

// What the Overview reads off each expense.
export interface OverviewReceiptRow {
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  tax_category: string;
  job_id: string | null;
  paid_with_account_id?: string | null;
  from_statement?: boolean | null;
  no_receipt?: boolean | null;
  tax_rate?: number | null;
  itc_pct?: number | null;
  deductible_pct?: number | null;
}

export interface LoadedOverviewReceipts {
  rows: OverviewReceiptRow[];
  /** More than 20,000 rows: only the first 20,000 (oldest first) were read. */
  truncated: boolean;
}

// Every expense with a transaction_date in the inclusive range (null = open end), oldest first. The order
// is the date plus the row id, so pages never repeat or skip a row.
export async function loadOverviewReceipts(
  supabase: ReadDb,
  from: string | null,
  to: string | null,
): Promise<LoadedOverviewReceipts> {
  const { rows, truncated } = await selectAll(() => {
    let query = supabase.from("receipts").select(OVERVIEW_RECEIPT_COLUMNS);
    if (from) query = query.gte("transaction_date", from);
    if (to) query = query.lte("transaction_date", to);
    return query.order("transaction_date", { ascending: true }).order("id", { ascending: true });
  });
  return { rows: rows as unknown as OverviewReceiptRow[], truncated };
}
