import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import {
  BULK_DELETE_BATCH,
  BULK_DELETE_MAX,
  DELETE_FAILED_REASON,
  cleanBatchId,
  cleanDeleteIds,
  deleteTotals,
  planBulkDelete,
  summarizeBatches,
  type DeleteRow,
  type SkippedRow,
} from "./bulk-delete.ts";

// The server half of the Expenses page's bulk delete and "Delete this import". Two modes behind one route
// (the route file only authenticates and forwards):
//
//   preview  {mode:"preview", ids | import_batch_id}   what would be deleted: count, total, tax, and the
//                                                      rows that would be skipped with the reason
//   apply    {mode:"apply", ids | import_batch_id, expected_count?, expected_total_cents?}
//                                                      deletes them
//
// The client names rows (ids, or one import's batch id); everything else is read here, with the session's
// user id on every query, so another account's row can never be touched, and the client's idea of what
// the rows are, or are worth, is never used. `expected_*` is what the confirmation dialog showed: if the
// rows have changed since (one deleted elsewhere, an import row edited) nothing is deleted and the
// dialog is told to look again (409 STALE_PREVIEW). A delete is the single delete, repeated: the owner's
// row, then its photo. It is a hard delete, so there is no undo. Failures carry fixed wording; no
// merchant, amount or path is logged or echoed.

type Db = SupabaseClient<Database>;
export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const COLUMNS = "id, merchant_name, transaction_date, total_amount, tax_amount, image_url";
const SLICE = 100;

async function loadByIds(db: Db, userId: string, ids: string[]): Promise<DeleteRow[]> {
  const rows: DeleteRow[] = [];
  for (let i = 0; i < ids.length; i += SLICE) {
    const { data, error } = await db
      .from("receipts")
      .select(COLUMNS)
      .eq("user_id", userId)
      .in("id", ids.slice(i, i + SLICE));
    if (error) throw new Error("load");
    rows.push(...((data ?? []) as DeleteRow[]));
  }
  return rows;
}

// One import's expenses. `null` = the batch column isn't there yet (migration 0074 not applied).
async function loadByBatch(db: Db, userId: string, batchId: string): Promise<DeleteRow[] | null> {
  const { data, error } = await db
    .from("receipts")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("import_batch_id", batchId)
    .limit(BULK_DELETE_MAX + 1);
  if (error) return null;
  return (data ?? []) as DeleteRow[];
}

const fail = (status: number, error: string, code?: string): HandlerResult => ({
  status,
  body: { error, ...(code && { code }) },
});

export async function handleBulkDelete(db: Db, userId: string, body: unknown): Promise<HandlerResult> {
  if (typeof body !== "object" || body === null) return fail(400, "Could not read the request.");
  const b = body as Record<string, unknown>;
  if (b.mode !== "preview" && b.mode !== "apply") return fail(400, "Unknown request.");

  const byBatch = b.import_batch_id !== undefined;
  if (byBatch === (b.ids !== undefined)) return fail(400, "Choose either some expenses or one import.");

  let requested: string[];
  let found: DeleteRow[];
  try {
    if (byBatch) {
      const batchId = cleanBatchId(b.import_batch_id);
      if (!batchId) return fail(400, "That isn't a valid import.");
      const rows = await loadByBatch(db, userId, batchId);
      if (rows === null) return fail(400, "Imports can't be listed yet.", "IMPORTS_UNAVAILABLE");
      if (rows.length > BULK_DELETE_MAX) return fail(400, `An import can be at most ${BULK_DELETE_MAX} expenses.`);
      found = rows;
      requested = rows.map((r) => r.id);
    } else {
      const ids = cleanDeleteIds(b.ids);
      if (!ids) return fail(400, `Choose between 1 and ${BULK_DELETE_MAX} expenses.`);
      requested = ids;
      found = await loadByIds(db, userId, ids);
    }
  } catch {
    return fail(500, "Could not check these expenses. Please try again.");
  }

  const { toDelete, skipped } = planBulkDelete(requested, found);
  const totals = deleteTotals(toDelete);

  if (b.mode === "preview") {
    return { status: 200, body: { ...totals, skipped } };
  }

  // ---- apply
  const expectedCount = b.expected_count;
  const expectedCents = b.expected_total_cents;
  if (
    (expectedCount !== undefined && expectedCount !== totals.count) ||
    (expectedCents !== undefined && expectedCents !== Math.round(totals.total * 100))
  ) {
    return fail(409, "These expenses changed since you looked. Nothing was deleted - check again.", "STALE_PREVIEW");
  }
  if (toDelete.length === 0) return { status: 200, body: { deleted: 0, deleted_ids: [], skipped, files_left: 0, total: 0, tax: 0 } };

  const deleted: DeleteRow[] = [];
  const failed: SkippedRow[] = [];
  for (let i = 0; i < toDelete.length; i += BULK_DELETE_BATCH) {
    const batch = toDelete.slice(i, i + BULK_DELETE_BATCH);
    const { data, error } = await db
      .from("receipts")
      .delete()
      .eq("user_id", userId)
      .in("id", batch.map((r) => r.id))
      .select("id");
    if (!error) {
      const gone = new Set((data ?? []).map((r) => r.id));
      for (const r of batch) {
        if (gone.has(r.id)) deleted.push(r);
        else failed.push({ id: r.id, reason: DELETE_FAILED_REASON });
      }
      continue;
    }
    // One refused row must not cost the batch: delete them one at a time to find it.
    for (const r of batch) {
      const one = await db.from("receipts").delete().eq("user_id", userId).eq("id", r.id).select("id");
      if (!one.error && (one.data ?? []).length > 0) deleted.push(r);
      else failed.push({ id: r.id, reason: DELETE_FAILED_REASON });
    }
  }

  // The photos go with the rows, the way the single delete removes them. Only paths inside this owner's own
  // folder are ever removed. A photo that can't be removed is counted, not fatal: the expense is gone.
  const paths = deleted.map((r) => r.image_url).filter((p): p is string => !!p && p.startsWith(`${userId}/`) && !p.includes(".."));
  let filesLeft = 0;
  for (let i = 0; i < paths.length; i += BULK_DELETE_BATCH) {
    const chunk = paths.slice(i, i + BULK_DELETE_BATCH);
    const { error } = await db.storage.from("receipts").remove(chunk);
    if (error) filesLeft += chunk.length;
  }

  const gone = deleteTotals(deleted);
  return {
    status: 200,
    body: {
      deleted: deleted.length,
      deleted_ids: deleted.map((r) => r.id),
      skipped: [...skipped, ...failed],
      files_left: filesLeft,
      total: gone.total,
      tax: gone.tax,
    },
  };
}

// The list behind the "Imports" button: recent imports with their row count and totals. Owner's rows only.
// If the batch column isn't there yet (migration 0074 not applied) the answer is an empty list, flagged
// unavailable, never an error.
const LIST_PAGE = 1000;
const LIST_MAX_PAGES = 10;

export async function handleListImports(db: Db, userId: string): Promise<HandlerResult> {
  const rows: { import_batch_id: string | null; created_at: string; total_amount: number; tax_amount: number }[] = [];
  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    const { data, error } = await db
      .from("receipts")
      .select("import_batch_id, created_at, total_amount, tax_amount")
      .eq("user_id", userId)
      .not("import_batch_id", "is", null)
      .order("created_at", { ascending: false })
      .range(page * LIST_PAGE, (page + 1) * LIST_PAGE - 1);
    if (error) return { status: 200, body: { batches: [], available: false } };
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < LIST_PAGE) break;
  }
  return { status: 200, body: { batches: summarizeBatches(rows), available: true } };
}
