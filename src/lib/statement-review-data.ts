import { loadCategoryOptions, loadOwnImport, type StatementCtx } from "@/lib/statement-server";
import { candidatesForLines, type ReceiptBrief } from "@/lib/statement-match-server";
import { reconcileStatement, type ReconcileResult } from "@/lib/statement-reconcile";
import type { MatchCandidate } from "@/lib/statement-matching";
import type { StatementLineKind, StatementImportStatus } from "@/lib/database.types";

// Everything the review screen needs in one read, shared by GET
// /api/statements/[id] (client reloads after an edit) and the review page (first
// paint). Every read goes through the caller's own session, so RLS decides what
// comes back; the line columns returned are an explicit list, never `*`.

export interface ReviewCandidate extends MatchCandidate {
  receipt: ReceiptBrief | null;
}

export interface ReviewLineData {
  id: string;
  page: number;
  line_no: number;
  txn_date: string;
  description: string;
  amount: number;
  kind: StatementLineKind;
  currency: string;
  original_amount: number | null;
  original_currency: string | null;
  duplicate_of_line_id: string | null;
  duplicate_override: boolean;
  suggested_category: string | null;
  category: string | null;
  category_confirmed: boolean;
  paid_with_account_id: string | null;
  tax_amount: number;
  resolution: "matched" | "new_expense" | "skipped" | null;
  matched_receipt_id: string | null;
  matched_receipt: ReceiptBrief | null;
  candidates: ReviewCandidate[];
}

export interface ReviewChunkData {
  chunk_no: number;
  page_from: number;
  page_to: number;
  status: "pending" | "done" | "failed";
  attempts: number;
  error_code: string | null;
}

export interface StatementReviewData {
  import: {
    id: string;
    account_id: string;
    status: StatementImportStatus;
    file_sha256: string;
    page_count: number;
    issuer: string | null;
    period_start: string | null;
    period_end: string | null;
    opening_balance: number | null;
    closing_balance: number | null;
    statement_total: number | null;
    statement_total_kind: "purchases" | "new_balance" | null;
    line_count: number | null;
    created_at: string;
  };
  chunks: ReviewChunkData[];
  lines: ReviewLineData[];
  reconcile: ReconcileResult;
  categories: string[];
}

export async function loadStatementReview(
  ctx: StatementCtx,
  id: string,
): Promise<StatementReviewData | null> {
  const imp = await loadOwnImport(ctx, id);
  if (!imp) return null;

  const [{ data: chunks }, { data: lines }, categories] = await Promise.all([
    ctx.supabase
      .from("statement_chunks")
      .select("chunk_no, page_from, page_to, status, attempts, error_code")
      .eq("import_id", id)
      .order("chunk_no", { ascending: true }),
    ctx.supabase
      .from("statement_lines")
      .select("*")
      .eq("import_id", id)
      .eq("user_id", ctx.user.id)
      .order("page", { ascending: true })
      .order("line_no", { ascending: true }),
    loadCategoryOptions(ctx),
  ]);

  const allLines = lines ?? [];
  const { candidates, briefs } = await candidatesForLines(ctx, allLines);

  return {
    import: {
      id: imp.id,
      account_id: imp.account_id,
      status: imp.status,
      file_sha256: imp.file_sha256,
      page_count: imp.page_count,
      issuer: imp.issuer,
      period_start: imp.period_start,
      period_end: imp.period_end,
      opening_balance: imp.opening_balance,
      closing_balance: imp.closing_balance,
      statement_total: imp.statement_total,
      statement_total_kind: imp.statement_total_kind,
      line_count: imp.line_count,
      created_at: imp.created_at,
    },
    chunks: chunks ?? [],
    lines: allLines.map((l) => ({
      id: l.id,
      page: l.page,
      line_no: l.line_no,
      txn_date: l.txn_date,
      description: l.description,
      amount: l.amount,
      kind: l.kind,
      currency: l.currency,
      original_amount: l.original_amount,
      original_currency: l.original_currency,
      duplicate_of_line_id: l.duplicate_of_line_id,
      duplicate_override: l.duplicate_override,
      suggested_category: l.suggested_category,
      category: l.category,
      category_confirmed: l.category_confirmed,
      paid_with_account_id: l.paid_with_account_id,
      tax_amount: l.tax_amount,
      resolution: l.resolution,
      matched_receipt_id: l.matched_receipt_id,
      matched_receipt: l.matched_receipt_id ? (briefs.get(l.matched_receipt_id) ?? null) : null,
      candidates: (candidates.get(l.id) ?? []).map((c) => ({ ...c, receipt: briefs.get(c.id) ?? null })),
    })),
    reconcile: reconcileStatement({
      lines: allLines,
      opening_balance: imp.opening_balance,
      closing_balance: imp.closing_balance,
      statement_total: imp.statement_total,
      statement_total_kind: imp.statement_total_kind,
    }),
    categories,
  };
}
