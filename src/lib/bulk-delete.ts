// Bulk delete of expenses, and "delete this import". The pure rules, shared by the confirmation dialog and
// the route's handler (bulk-delete-server.ts).
//
// What "the single-expense delete's rules" are, today: there are none beyond ownership. DELETE
// /api/receipts/[id] removes the owner's row (a hard delete, no soft-delete and so no undo) and then its
// photo from storage; the database does the rest in a trigger - a statement-created or matched expense
// frees its statement line (0053/0058), so a statement-linked expense IS deletable, and an automatic Stripe
// fee expense is too. No expense is "paid" or "locked". So the bulk delete enforces exactly that: only this
// owner's rows, each one removed the way the single delete removes it; a row that is not there (already
// deleted, or not theirs) or that the database refuses is skipped with a reason, and the rest go.

import { cleanIds } from "./bulk-category.ts";

export const BULK_DELETE_MAX = 500;
// How many rows go into one delete / one storage removal.
export const BULK_DELETE_BATCH = 100;

export const NOT_FOUND_REASON = "Already deleted, or not yours";
export const DELETE_FAILED_REASON = "Could not be deleted";

export interface DeleteRow {
  id: string;
  merchant_name: string;
  transaction_date: string;
  total_amount: number;
  tax_amount: number;
  image_url: string | null;
}

export interface SkippedRow {
  id: string;
  reason: string;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface DeleteTotals {
  count: number;
  total: number;
  tax: number;
}

// What the confirmation shows: how many, their total amount and their total tax. Signed (a credit note
// reduces the total), so it is the figure that will actually leave the books.
export function deleteTotals(rows: Pick<DeleteRow, "total_amount" | "tax_amount">[]): DeleteTotals {
  let total = 0;
  let tax = 0;
  for (const r of rows) {
    total += Number(r.total_amount);
    tax += Number(r.tax_amount);
  }
  return { count: rows.length, total: round2(total), tax: round2(tax) };
}

// Which requested ids will be deleted and which are skipped (with why). `found` is what the server read
// for THIS owner; an id with no row there is skipped, never deleted blindly.
export function planBulkDelete(
  requestedIds: string[],
  found: DeleteRow[],
): { toDelete: DeleteRow[]; skipped: SkippedRow[] } {
  const byId = new Map(found.map((r) => [r.id, r]));
  const toDelete: DeleteRow[] = [];
  const skipped: SkippedRow[] = [];
  for (const id of requestedIds) {
    const row = byId.get(id);
    if (row) toDelete.push(row);
    else skipped.push({ id, reason: NOT_FOUND_REASON });
  }
  return { toDelete, skipped };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanBatchId(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

// The ids of a delete request: a list of uuids (no repeats), at most BULK_DELETE_MAX.
export function cleanDeleteIds(value: unknown): string[] | null {
  const ids = cleanIds(value);
  return ids && ids.length > 0 && ids.length <= BULK_DELETE_MAX ? ids : null;
}

// ---------------------------------------------------------------- the list of imports

export interface BatchSummary {
  id: string;
  /** When the import happened (its earliest row's created_at, ISO). */
  imported_at: string;
  rows: number;
  total: number;
  tax: number;
}

export interface BatchedRow {
  import_batch_id: string | null;
  created_at: string;
  total_amount: number;
  tax_amount: number;
}

// Recent imports, newest first: one entry per batch id with its row count and totals.
export function summarizeBatches(rows: BatchedRow[], limit = 20): BatchSummary[] {
  const by = new Map<string, BatchSummary>();
  for (const r of rows) {
    if (!r.import_batch_id) continue;
    const b = by.get(r.import_batch_id) ?? { id: r.import_batch_id, imported_at: r.created_at, rows: 0, total: 0, tax: 0 };
    b.rows += 1;
    b.total += Number(r.total_amount);
    b.tax += Number(r.tax_amount);
    if (r.created_at < b.imported_at) b.imported_at = r.created_at;
    by.set(r.import_batch_id, b);
  }
  return [...by.values()]
    .map((b) => ({ ...b, total: round2(b.total), tax: round2(b.tax) }))
    .sort((a, b) => (a.imported_at < b.imported_at ? 1 : a.imported_at > b.imported_at ? -1 : a.id < b.id ? -1 : 1))
    .slice(0, limit);
}
