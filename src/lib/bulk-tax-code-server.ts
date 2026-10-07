import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { BULK_CATEGORY_MAX, cleanIds } from "./bulk-category.ts";
import { cleanTaxChanges, planBulkTaxCode, type TaxBulkRow, type TaxChange } from "./bulk-tax-code.ts";
import {
  currentTaxPatch,
  isCalculated,
  isTaxCodeKey,
  samePatch,
  taxPatchForCode,
  type TaxCodeKey,
  type TaxPatch,
} from "./tax-codes.ts";
import type { BulkResult } from "./bulk-category-server.ts";

// The server half of the Expenses page's bulk "Set tax code". It writes ONLY the four tax-code columns
// and tax_amount, ONLY on a calculated statement expense (from_statement and no receipt attached).
// A row with a receipt, a confirmed row, or one whose tax the owner typed is never written - the
// preview counts them as skipped and says why. Three modes behind one route (the route only
// authenticates and forwards):
//
//   preview  {mode:"preview", ids, code}      dry run: the plan, nothing written
//   apply    {mode:"apply", code, changes}    `changes` is what the preview returned ([{id, prev}]);
//                                              every row must STILL be in exactly its `prev` tax
//                                              state, and still a calculated row, or nothing is
//                                              written (409 STALE_PREVIEW). The new tax is recomputed
//                                              here from the stored rows - never taken from the request.
//   undo     {mode:"undo", code, changes}      puts the previous code and tax back, but only on rows
//                                              still exactly as apply left them (one edited, or given
//                                              a receipt, since is left alone)
//
// Ownership is the caller's RLS client plus an explicit user_id filter. Kept here (taking a client)
// so it can be tested as a real signed-in user.

const SLICE = 100;
type Db = SupabaseClient<Database>;

const fail = (status: number, error: string, code?: string): BulkResult => ({
  status,
  body: { error, ...(code && { code }) },
});

const COLUMNS =
  "id, tax_category, total_amount, tax_amount, from_statement, no_receipt, tax_rate, itc_pct, deductible_pct, tax_source";

async function loadRows(db: Db, userId: string, ids: string[]): Promise<TaxBulkRow[]> {
  const rows: TaxBulkRow[] = [];
  for (let i = 0; i < ids.length; i += SLICE) {
    const { data, error } = await db
      .from("receipts")
      .select(COLUMNS)
      .eq("user_id", userId)
      .in("id", ids.slice(i, i + SLICE));
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as TaxBulkRow[]));
  }
  return rows;
}

// One row: set `next` only if the row is still a calculated expense in exactly the `expect` state.
async function updateTax(db: Db, userId: string, id: string, expect: TaxPatch, next: TaxPatch): Promise<boolean> {
  let q = db
    .from("receipts")
    .update(next)
    .eq("id", id)
    .eq("user_id", userId)
    .eq("from_statement", true)
    .eq("no_receipt", true)
    .eq("tax_amount", expect.tax_amount);
  q = expect.tax_rate === null ? q.is("tax_rate", null) : q.eq("tax_rate", expect.tax_rate);
  q = expect.itc_pct === null ? q.is("itc_pct", null) : q.eq("itc_pct", expect.itc_pct);
  q = expect.deductible_pct === null ? q.is("deductible_pct", null) : q.eq("deductible_pct", expect.deductible_pct);
  q = expect.tax_source === null ? q.is("tax_source", null) : q.eq("tax_source", expect.tax_source);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length === 1;
}

export async function handleBulkTaxCode(db: Db, userId: string, body: unknown): Promise<BulkResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = b.mode;
  if (mode !== "preview" && mode !== "apply" && mode !== "undo") {
    return fail(400, "mode must be preview, apply or undo.");
  }
  if (!isTaxCodeKey(b.code)) return fail(400, "Choose a tax code.");
  const code: TaxCodeKey = b.code;

  try {
    if (mode === "preview") {
      const ids = cleanIds(b.ids);
      if (!ids || ids.length === 0) return fail(400, "Select at least one expense.");
      if (ids.length > BULK_CATEGORY_MAX) {
        return fail(400, `Select at most ${BULK_CATEGORY_MAX} expenses at a time.`);
      }
      return { status: 200, body: { plan: planBulkTaxCode(ids, await loadRows(db, userId, ids), code) } };
    }

    const changes = cleanTaxChanges(b.changes);
    if (!changes || changes.length === 0) return fail(400, "Nothing to change.");
    if (changes.length > BULK_CATEGORY_MAX) return fail(400, `At most ${BULK_CATEGORY_MAX} expenses at a time.`);
    const ids = changes.map((c) => c.id);
    const rows = await loadRows(db, userId, ids);
    const byId = new Map(rows.map((r) => [r.id, r]));

    if (mode === "undo") return await undo(db, userId, code, changes, byId);

    // apply: every row must still be a calculated row in exactly the state the preview saw.
    const stale = changes.filter((c) => {
      const r = byId.get(c.id);
      return !r || !isCalculated(r) || !samePatch(currentTaxPatch(r), c.prev);
    }).length;
    if (stale > 0) {
      return fail(
        409,
        `${stale} of these expenses changed, got a receipt or were deleted since the preview. Nothing was changed - preview again.`,
        "STALE_PREVIEW",
      );
    }

    // The new tax is recomputed from the stored rows - whatever the request claimed is ignored.
    const plan = planBulkTaxCode(ids, rows, code);
    if (plan.will_change !== ids.length) {
      return fail(409, "Some of these can no longer take that code. Nothing was changed - preview again.", "STALE_PREVIEW");
    }
    const patchOf = new Map(plan.retax.map((r) => [r.id, r.patch]));

    const done: TaxChange[] = [];
    for (const c of changes) {
      if (await updateTax(db, userId, c.id, c.prev, patchOf.get(c.id)!)) done.push(c);
    }
    if (done.length !== changes.length) {
      // A row slipped out from under us between the check and the write: put back what moved.
      for (const c of done) await updateTax(db, userId, c.id, patchOf.get(c.id)!, c.prev);
      return fail(409, "Some expenses changed while saving. Nothing was changed - preview again.", "STALE_PREVIEW");
    }
    return {
      status: 200,
      body: { code, changed: done.length, previous: changes, retaxed: plan.retax },
    };
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Something went wrong.");
  }
}

async function undo(
  db: Db,
  userId: string,
  code: TaxCodeKey,
  changes: TaxChange[],
  byId: Map<string, TaxBulkRow>,
): Promise<BulkResult> {
  const restored: { id: string; tax: TaxPatch }[] = [];
  for (const c of changes) {
    const r = byId.get(c.id);
    // Only a row still exactly as apply left it (the code's tax at its total, no receipt).
    if (!r || !isCalculated(r) || !samePatch(currentTaxPatch(r), taxPatchForCode(r.total_amount, code))) continue;
    if (await updateTax(db, userId, c.id, currentTaxPatch(r), c.prev)) restored.push({ id: c.id, tax: c.prev });
  }
  return {
    status: 200,
    body: { restored: restored.length, left_alone: changes.length - restored.length, restored_rows: restored },
  };
}
