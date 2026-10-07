import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { alreadyImportedInfo, type AlreadyImportedInfo } from "./statement-reimport.ts";
import {
  expectationMatches,
  expectationOf,
  planStatementDelete,
  type DeleteExpectation,
  type DeleteLine,
  type DeletePlan,
  type DeleteReceipt,
} from "./statement-delete.ts";
import {
  outcomeOf,
  reconcileLabel,
  summarizeLines,
  type ImportSummary,
  type LineOutcome,
  type ReconcileTone,
} from "./statement-summary.ts";
import { torontoMonthStart } from "./toronto-month.ts";

// The server half of saved-statement grouping: the Statements list, a statement's detail, "Delete
// statement" (preview + apply) and the data behind the ALREADY_IMPORTED refusal and Re-import.
// Reads go through the caller's own session (RLS scopes them) and are re-filtered on user_id; the
// few writes that only the service role may make take the `admin` client. Relative imports only, so
// the database test runs this exact code.

type Db = SupabaseClient<Database>;
const SLICE = 100;

// A saved import is one that was committed; a DELETED one is a committed import since marked
// discarded (an abandoned draft is also 'discarded', but it never has a committed_at).
const IMPORT_COLUMNS =
  "id, account_id, status, file_sha256, issuer, period_start, period_end, opening_balance, closing_balance, statement_total, reconcile_diff, reconcile_acknowledged, line_count, committed_at, created_at";
const LINE_COLUMNS =
  "id, page, line_no, txn_date, description, amount, kind, resolution, created_receipt_id, matched_receipt_id, released_at, released_from, duplicate_of_line_id";

interface ImportRow {
  id: string;
  account_id: string;
  status: string;
  file_sha256: string;
  issuer: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  statement_total: number | null;
  reconcile_diff: number | null;
  reconcile_acknowledged: boolean;
  line_count: number | null;
  committed_at: string | null;
  created_at: string;
}

interface LineRow {
  id: string;
  page: number;
  line_no: number;
  txn_date: string;
  description: string;
  amount: number;
  kind: string;
  resolution: "matched" | "new_expense" | "skipped" | null;
  created_receipt_id: string | null;
  matched_receipt_id: string | null;
  released_at: string | null;
  released_from: "new_expense" | "matched" | null;
  duplicate_of_line_id: string | null;
}

const isSaved = (i: ImportRow) => i.committed_at !== null && (i.status === "committed" || i.status === "discarded");

async function loadImport(db: Db, userId: string, importId: string): Promise<ImportRow | null> {
  const { data } = await db
    .from("statement_imports")
    .select(IMPORT_COLUMNS)
    .eq("id", importId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as unknown as ImportRow | null;
  return row && isSaved(row) ? row : null;
}

async function loadLines(db: Db, userId: string, importId: string): Promise<LineRow[]> {
  const { data, error } = await db
    .from("statement_lines")
    .select(LINE_COLUMNS)
    .eq("import_id", importId)
    .eq("user_id", userId)
    .order("page", { ascending: true })
    .order("line_no", { ascending: true })
    .limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as LineRow[];
}

async function loadReceipts(db: Db, userId: string, ids: string[]): Promise<DeleteReceipt[]> {
  const out: DeleteReceipt[] = [];
  for (let i = 0; i < ids.length; i += SLICE) {
    const { data, error } = await db
      .from("receipts")
      .select("id, merchant_name, transaction_date, total_amount, tax_amount, tax_category, from_statement, no_receipt, job_name")
      .eq("user_id", userId)
      .in("id", ids.slice(i, i + SLICE));
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as unknown as DeleteReceipt[]));
  }
  return out;
}

async function accountNames(db: Db, userId: string): Promise<Map<string, string>> {
  const { data } = await db.from("bank_accounts").select("id, name").eq("user_id", userId);
  return new Map((data ?? []).map((a) => [a.id as string, a.name as string]));
}

// ---------------------------------------------------------------------------
// The Statements list
// ---------------------------------------------------------------------------

export interface StatementListItem {
  id: string;
  deleted: boolean;
  account_name: string;
  issuer: string | null;
  period_start: string | null;
  period_end: string | null;
  saved_at: string;
  summary: ImportSummary;
  reconcile: { label: string; tone: ReconcileTone };
}

export async function loadStatementList(
  db: Db,
  userId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<StatementListItem[]> {
  const { data, error } = await db
    .from("statement_imports")
    .select(IMPORT_COLUMNS)
    .eq("user_id", userId)
    .not("committed_at", "is", null)
    .in("status", options.includeDeleted ? ["committed", "discarded"] : ["committed"])
    .order("committed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const imports = (data ?? []) as unknown as ImportRow[];
  const names = await accountNames(db, userId);

  return Promise.all(
    imports.map(async (i) => ({
      id: i.id,
      deleted: i.status === "discarded",
      account_name: names.get(i.account_id) ?? "Card",
      issuer: i.issuer,
      period_start: i.period_start,
      period_end: i.period_end,
      saved_at: i.committed_at!,
      summary: summarizeLines(await loadLines(db, userId, i.id)),
      reconcile: reconcileLabel(i),
    })),
  );
}

/** How many deleted statements exist (to show "Show deleted (n)"). */
export async function countDeletedStatements(db: Db, userId: string): Promise<number> {
  const { count } = await db
    .from("statement_imports")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("status", "discarded")
    .not("committed_at", "is", null);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// One statement
// ---------------------------------------------------------------------------

export interface DetailLine {
  id: string;
  txn_date: string;
  description: string;
  amount: number;
  kind: string;
  outcome: LineOutcome;
  /** The expense or receipt this line created / was matched to, while it still exists. */
  receipt: {
    id: string;
    merchant_name: string;
    total_amount: number;
    has_receipt: boolean;
    tax_category: string;
  } | null;
}

export interface StatementDetail {
  id: string;
  deleted: boolean;
  account_name: string;
  issuer: string | null;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  statement_total: number | null;
  saved_at: string;
  summary: ImportSummary;
  reconcile: { label: string; tone: ReconcileTone };
  lines: DetailLine[];
}

export async function loadStatementDetail(db: Db, userId: string, importId: string): Promise<StatementDetail | null> {
  const imp = await loadImport(db, userId, importId);
  if (!imp) return null;
  const lines = await loadLines(db, userId, importId);
  const ids = [...new Set(lines.flatMap((l) => [l.created_receipt_id, l.matched_receipt_id]).filter((x): x is string => !!x))];
  const receipts = new Map((await loadReceipts(db, userId, ids)).map((r) => [r.id, r as DeleteReceipt & { tax_category?: string }]));
  const names = await accountNames(db, userId);

  return {
    id: imp.id,
    deleted: imp.status === "discarded",
    account_name: names.get(imp.account_id) ?? "Card",
    issuer: imp.issuer,
    period_start: imp.period_start,
    period_end: imp.period_end,
    opening_balance: imp.opening_balance,
    closing_balance: imp.closing_balance,
    statement_total: imp.statement_total,
    saved_at: imp.committed_at!,
    summary: summarizeLines(lines),
    reconcile: reconcileLabel(imp),
    lines: lines.map((l) => {
      const rid = l.created_receipt_id ?? l.matched_receipt_id;
      const r = rid ? receipts.get(rid) : undefined;
      return {
        id: l.id,
        txn_date: l.txn_date,
        description: l.description,
        amount: l.amount,
        kind: l.kind,
        outcome: outcomeOf(l),
        receipt: r
          ? {
              id: r.id,
              merchant_name: r.merchant_name,
              total_amount: r.total_amount,
              has_receipt: !(r.from_statement === true && r.no_receipt === true),
              tax_category: (r as { tax_category?: string }).tax_category ?? "",
            }
          : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Delete statement
// ---------------------------------------------------------------------------

export interface DeletePreview {
  plan: {
    delete: { receipt_id: string; merchant_name: string; transaction_date: string; total_amount: number; job_name: string | null }[];
    keep: { receipt_id: string; merchant_name: string; total_amount: number }[];
    counts: DeletePlan["counts"];
  };
  expect: DeleteExpectation;
}

function previewOf(plan: DeletePlan): DeletePreview {
  return {
    plan: {
      delete: plan.delete.map((d) => ({
        receipt_id: d.receipt.id,
        merchant_name: d.receipt.merchant_name,
        transaction_date: d.receipt.transaction_date,
        total_amount: d.receipt.total_amount,
        job_name: d.receipt.job_name ?? null,
      })),
      keep: plan.keep.map((k) => ({
        receipt_id: k.receipt.id,
        merchant_name: k.receipt.merchant_name,
        total_amount: k.receipt.total_amount,
      })),
      counts: plan.counts,
    },
    expect: expectationOf(plan),
  };
}

async function deletePlanFor(db: Db, userId: string, importId: string): Promise<DeletePlan> {
  const lines = await loadLines(db, userId, importId);
  const ids = lines.map((l) => l.created_receipt_id).filter((x): x is string => !!x);
  return planStatementDelete(lines as unknown as DeleteLine[], await loadReceipts(db, userId, ids));
}

export interface GroupResult {
  status: number;
  body: Record<string, unknown>;
}
const fail = (status: number, error: string, code?: string, extra: Record<string, unknown> = {}): GroupResult => ({
  status,
  body: { error, ...(code && { code }), ...extra },
});

export async function previewStatementDelete(db: Db, userId: string, importId: string): Promise<GroupResult> {
  const imp = await loadImport(db, userId, importId);
  if (!imp) return fail(404, "Not found");
  if (imp.status !== "committed") return fail(409, "This statement was already deleted.", "ALREADY_DELETED");
  return { status: 200, body: previewOf(await deletePlanFor(db, userId, importId)) as unknown as Record<string, unknown> };
}

// Deletes the statement's expenses that have NO receipt attached, frees the lines of matched
// receipts (which are never touched), and marks the import discarded so the same file can be
// uploaded again. The expenses with a receipt stay. Steps are idempotent, so a half-finished run is
// simply run again; the import is marked discarded LAST. `expect` is what the preview showed: if
// anything changed since (a receipt attached, an expense deleted by hand) nothing is written (409).
export async function applyStatementDelete(
  db: Db,
  admin: Db,
  userId: string,
  importId: string,
  expect: DeleteExpectation,
): Promise<GroupResult> {
  const imp = await loadImport(db, userId, importId);
  if (!imp) return fail(404, "Not found");
  if (imp.status !== "committed") return fail(409, "This statement was already deleted.", "ALREADY_DELETED");

  const plan = await deletePlanFor(db, userId, importId);
  if (!expectationMatches(plan, expect)) {
    return fail(
      409,
      "Something changed since the preview (a receipt was attached, or an expense was deleted). Nothing was deleted - check the new counts.",
      "STALE_PREVIEW",
      previewOf(plan) as unknown as Record<string, unknown>,
    );
  }

  // 1. The expenses with no receipt. Guarded on the row STILL having none, so a receipt attached in
  //    the instant after the check keeps its expense. Each delete frees its line (the trigger).
  const deleted: string[] = [];
  const deleteIds = plan.delete.map((d) => d.receipt.id);
  for (let i = 0; i < deleteIds.length; i += SLICE) {
    const { data, error } = await db
      .from("receipts")
      .delete()
      .eq("user_id", userId)
      .eq("from_statement", true)
      .eq("no_receipt", true)
      .in("id", deleteIds.slice(i, i + SLICE))
      .select("id");
    if (error) throw new Error(error.message);
    deleted.push(...(data ?? []).map((r) => r.id as string));
  }

  // 2. Lines matched to ordinary receipts are freed; the receipts themselves are never touched.
  const unlinkIds = plan.unlink.map((u) => u.line_id);
  for (let i = 0; i < unlinkIds.length; i += SLICE) {
    const { error } = await admin
      .from("statement_lines")
      .update({
        resolution: "skipped",
        matched_receipt_id: null,
        released_at: new Date().toISOString(),
        released_from: "matched",
      })
      .eq("user_id", userId)
      .eq("import_id", importId)
      .eq("resolution", "matched")
      .in("id", unlinkIds.slice(i, i + SLICE));
    if (error) throw new Error(error.message);
  }

  // 3. Last: the import itself, so the same file can be uploaded again.
  const { error: markError } = await admin
    .from("statement_imports")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("user_id", userId)
    .eq("status", "committed");
  if (markError) throw new Error(markError.message);

  return {
    status: 200,
    body: {
      deleted: deleted.length,
      // Planned for deletion but a receipt arrived in the last instant: kept.
      kept_after_preview: deleteIds.length - deleted.length,
      kept_with_receipt: plan.keep.length,
      unlinked: plan.unlink.length,
    },
  };
}

// ---------------------------------------------------------------------------
// ALREADY_IMPORTED and Re-import
// ---------------------------------------------------------------------------

// How many imports this user has started this Toronto month - the same count start_statement_import
// enforces the cap with (everything except 'failed', which read nothing and cost nothing).
export async function monthlyImportUsage(db: Db, userId: string, now: Date = new Date()): Promise<number> {
  const { count } = await db
    .from("statement_imports")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("status", "failed")
    .gte("created_at", torontoMonthStart(now).toISOString());
  return count ?? 0;
}

/** The saved import for this exact file, with what a re-import would bring back. */
export async function alreadyImportedFor(
  db: Db,
  userId: string,
  fileSha256: string,
  cap: number | null,
): Promise<AlreadyImportedInfo | null> {
  const { data } = await db
    .from("statement_imports")
    .select(IMPORT_COLUMNS)
    .eq("user_id", userId)
    .eq("file_sha256", fileSha256)
    .eq("status", "committed")
    .maybeSingle();
  const imp = data as unknown as ImportRow | null;
  if (!imp || !imp.committed_at) return null;
  const used = await monthlyImportUsage(db, userId);
  return alreadyImportedInfo(imp.id, imp.committed_at, await loadLines(db, userId, imp.id), { used, cap });
}

// Retires the saved import so the same file can start again (committed -> discarded, guarded on the
// import still being that file's committed one). Returns false if it wasn't.
export async function releaseForReimport(admin: Db, userId: string, importId: string, fileSha256: string): Promise<boolean> {
  const { data, error } = await admin
    .from("statement_imports")
    .update({ status: "discarded", updated_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("user_id", userId)
    .eq("file_sha256", fileSha256)
    .eq("status", "committed")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length === 1;
}

// The compensation when starting the new import fails after the old one was retired: put it back, so
// nothing vanishes from the list without a replacement.
export async function restoreAfterFailedReimport(admin: Db, userId: string, importId: string): Promise<void> {
  await admin
    .from("statement_imports")
    .update({ status: "committed", updated_at: new Date().toISOString() })
    .eq("id", importId)
    .eq("user_id", userId)
    .eq("status", "discarded")
    .not("committed_at", "is", null);
}

// ---------------------------------------------------------------------------
// From an expense back to its statement (the drawer's link)
// ---------------------------------------------------------------------------

export interface StatementForReceipt {
  import_id: string;
  issuer: string | null;
  period_start: string | null;
  period_end: string | null;
  deleted: boolean;
}

export async function findStatementForReceipt(
  db: Db,
  userId: string,
  receiptId: string,
): Promise<StatementForReceipt | null> {
  // The id goes into a PostgREST filter string, so only a real uuid is ever allowed through.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receiptId)) return null;
  const { data: lines } = await db
    .from("statement_lines")
    .select("import_id")
    .eq("user_id", userId)
    .or(`created_receipt_id.eq.${receiptId},matched_receipt_id.eq.${receiptId}`)
    .limit(1);
  const importId = lines?.[0]?.import_id as string | undefined;
  if (!importId) return null;
  const imp = await loadImport(db, userId, importId);
  if (!imp) return null;
  return {
    import_id: imp.id,
    issuer: imp.issuer,
    period_start: imp.period_start,
    period_end: imp.period_end,
    deleted: imp.status === "discarded",
  };
}
