import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { resolveExistingCategory } from "./expense-categories.ts";
import {
  BULK_CATEGORY_MAX,
  cleanChanges,
  cleanIds,
  isMeals,
  planBulkCategory,
  type BulkChange,
  type BulkRow,
} from "./bulk-category.ts";
import { loadCategoryRows } from "./statement-bank-charges.ts";
import { bankChargesSuggestion, resolveBankCharges } from "./statement-categories.ts";
import { buildCategoryDefaults, type CategoryDefaults, type TaxPatch } from "./tax-codes.ts";

// The server half of the Expenses page's bulk "Change category". It writes `tax_category`, and
// ONLY on a calculated statement expense whose tax code follows its category, that row's tax code
// and calculated tax too (see bulk-category.ts). A confirmed row's tax_amount is never touched, and
// it never learns a vendor rule. Three modes behind one route (the route file only authenticates
// and forwards):
//
//   preview  {mode:"preview", ids, category}      dry run: the plan, nothing written
//   apply    {mode:"apply", category, changes, confirm_meals?}
//                                                  `changes` is what the preview returned
//                                                  ([{id, from}]); every row must STILL be in its
//                                                  `from` category or nothing is written
//                                                  (409 STALE_PREVIEW). Any new tax is recomputed
//                                                  here from the stored rows - never taken from
//                                                  the request.
//   undo     {mode:"undo", category, changes}      puts rows back (a recalculated row gets its
//                                                  previous code and tax back), but only those
//                                                  still in `category` (one edited since is left)
//
// Ownership is the caller's RLS client plus an explicit user_id filter. The ids are frozen by the
// client at preview time; the server never re-derives a selection. Kept here (taking a client)
// rather than in the route so it can be tested as a real signed-in user.

// PostgREST puts `in (...)` in the URL, so large lists go in slices.
const SLICE = 100;

type Db = SupabaseClient<Database>;
export interface BulkResult {
  status: number;
  body: Record<string, unknown>;
}
const fail = (status: number, error: string, code?: string): BulkResult => ({
  status,
  body: { error, ...(code && { code }) },
});

const FULL_COLUMNS =
  "id, tax_category, total_amount, tax_amount, from_statement, no_receipt, tax_rate, itc_pct, deductible_pct, tax_source";
const BASIC_COLUMNS = "id, tax_category, total_amount, tax_amount, from_statement, no_receipt";

async function loadRows(db: Db, userId: string, ids: string[]): Promise<BulkRow[]> {
  const rows: BulkRow[] = [];
  let columns = FULL_COLUMNS;
  for (let i = 0; i < ids.length; i += SLICE) {
    const slice = ids.slice(i, i + SLICE);
    let res = await db.from("receipts").select(columns).eq("user_id", userId).in("id", slice);
    if (res.error?.code === "42703" && columns === FULL_COLUMNS) {
      // 0057 (tax codes) isn't applied yet: no row has a code, so only the category moves.
      columns = BASIC_COLUMNS;
      res = await db.from("receipts").select(columns).eq("user_id", userId).in("id", slice);
    }
    if (res.error) throw new Error(res.error.message);
    rows.push(...((res.data ?? []) as unknown as BulkRow[]));
  }
  return rows;
}

// The category defaults for this owner: only their bank charges category (found by its stable key).
async function loadDefaults(db: Db, userId: string): Promise<CategoryDefaults> {
  const state = resolveBankCharges(await loadCategoryRows(db, userId));
  return buildCategoryDefaults({ bankChargesName: bankChargesSuggestion(state) });
}

// Sets tax_category on `ids` (only rows currently in one of `fromCategories`, so a row edited in
// the meantime is skipped rather than overwritten). Returns the ids actually changed.
async function setCategory(
  db: Db,
  userId: string,
  ids: string[],
  fromCategories: string[],
  to: string,
): Promise<string[]> {
  const changed: string[] = [];
  for (let i = 0; i < ids.length; i += SLICE) {
    const { data, error } = await db
      .from("receipts")
      .update({ tax_category: to })
      .eq("user_id", userId)
      .in("id", ids.slice(i, i + SLICE))
      .in("tax_category", fromCategories)
      .select("id");
    if (error) throw new Error(error.message);
    changed.push(...(data ?? []).map((r) => r.id));
  }
  return changed;
}

// One calculated row: its category AND its tax code/calculated tax, guarded on both the category it
// is leaving and on still having no receipt (a receipt attached meanwhile makes it confirmed, so
// the update then matches nothing and the row is left alone).
async function setCategoryAndTax(
  db: Db,
  userId: string,
  id: string,
  from: string,
  to: string,
  tax: TaxPatch,
): Promise<boolean> {
  const { data, error } = await db
    .from("receipts")
    .update({ tax_category: to, ...tax })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("tax_category", from)
    .eq("no_receipt", true)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length === 1;
}

function groupByFrom(ids: string[], fromOf: Map<string, string>): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const from = fromOf.get(id)!;
    groups.set(from, [...(groups.get(from) ?? []), id]);
  }
  return groups;
}

export async function handleBulkCategory(db: Db, userId: string, body: unknown): Promise<BulkResult> {
  const b = (body ?? {}) as Record<string, unknown>;
  const mode = b.mode;
  if (mode !== "preview" && mode !== "apply" && mode !== "undo") {
    return fail(400, "mode must be preview, apply or undo.");
  }

  // Undo may restore into a since-deactivated category; a new target must be active.
  const category = await resolveExistingCategory(db, userId, b.category, { activeOnly: mode !== "undo" });
  if (!category) return fail(400, "That category doesn't exist.");

  try {
    if (mode === "preview") {
      const ids = cleanIds(b.ids);
      if (!ids || ids.length === 0) return fail(400, "Select at least one expense.");
      if (ids.length > BULK_CATEGORY_MAX) {
        return fail(400, `Select at most ${BULK_CATEGORY_MAX} expenses at a time.`);
      }
      const [rows, defaults] = await Promise.all([loadRows(db, userId, ids), loadDefaults(db, userId)]);
      return { status: 200, body: { category, plan: planBulkCategory(ids, rows, category, defaults) } };
    }

    const changes = cleanChanges(b.changes);
    if (!changes || changes.length === 0) return fail(400, "Nothing to change.");
    if (changes.length > BULK_CATEGORY_MAX) {
      return fail(400, `At most ${BULK_CATEGORY_MAX} expenses at a time.`);
    }
    const ids = changes.map((c) => c.id);
    const fromOf = new Map(changes.map((c) => [c.id, c.from]));
    const rows = await loadRows(db, userId, ids);
    const current = new Map(rows.map((r) => [r.id, r.tax_category]));

    if (mode === "undo") return await undo(db, userId, category, changes, current);

    // apply: every row must still be exactly what the preview showed.
    const stale = changes.filter((c) => current.get(c.id) !== c.from).length;
    if (stale > 0) {
      return fail(
        409,
        `${stale} of these expenses changed or were deleted since the preview. Nothing was changed - preview again.`,
        "STALE_PREVIEW",
      );
    }
    if (changes.some((c) => c.from.trim().toLowerCase() === category.toLowerCase())) {
      return fail(400, "Some of these are already in that category.");
    }
    const mealsInvolved = isMeals(category) || changes.some((c) => isMeals(c.from));
    if (mealsInvolved && b.confirm_meals !== true) {
      return fail(400, "Meals changes how much sales tax is reclaimable. Confirm it first.", "MEALS_CONFIRM_REQUIRED");
    }

    // The tax is recomputed here from the stored rows - whatever the request claimed is ignored.
    const plan = planBulkCategory(ids, rows, category, await loadDefaults(db, userId));
    const retax = new Map(plan.retax.map((r) => [r.id, r.patch]));
    const prevOf = new Map(plan.changes.map((c) => [c.id, c.prev]));
    const plainIds = ids.filter((id) => !retax.has(id));

    const changed: string[] = [];
    const reverts: (() => Promise<unknown>)[] = [];
    const fromCategories = [...new Set(plainIds.map((id) => fromOf.get(id)!))];
    if (plainIds.length > 0) {
      const done = await setCategory(db, userId, plainIds, fromCategories, category);
      changed.push(...done);
      reverts.push(async () => {
        for (const [from, group] of groupByFrom(done, fromOf)) await setCategory(db, userId, group, [category], from);
      });
    }
    for (const id of retax.keys()) {
      if (await setCategoryAndTax(db, userId, id, fromOf.get(id)!, category, retax.get(id)!)) {
        changed.push(id);
        reverts.push(async () => {
          await setCategoryAndTax(db, userId, id, category, fromOf.get(id)!, prevOf.get(id)!);
        });
      }
    }
    if (changed.length !== ids.length) {
      // A row slipped out from under us between the check and the write: put back what moved.
      for (const revert of reverts) await revert();
      return fail(409, "Some expenses changed while saving. Nothing was changed - preview again.", "STALE_PREVIEW");
    }
    return {
      status: 200,
      body: {
        category,
        changed: changed.length,
        recalculated: retax.size,
        previous: plan.changes,
        retaxed: plan.retax,
      },
    };
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Something went wrong.");
  }
}

async function undo(
  db: Db,
  userId: string,
  category: string,
  changes: BulkChange[],
  current: Map<string, string>,
): Promise<BulkResult> {
  // Only rows still sitting in the category they were moved to are put back.
  const stillThere = changes.filter((c) => current.get(c.id) === category);
  const restored: { id: string; category: string; tax?: TaxPatch }[] = [];

  // Rows whose tax was recalculated get their previous code and tax back (if they are still
  // calculated); everything else is a plain category restore.
  const plain: BulkChange[] = [];
  for (const c of stillThere) {
    const target = await resolveExistingCategory(db, userId, c.from);
    if (!target) continue;
    if (c.prev && (await setCategoryAndTax(db, userId, c.id, category, target, c.prev))) {
      restored.push({ id: c.id, category: target, tax: c.prev });
    } else {
      plain.push({ ...c, from: target });
    }
  }
  const plainFrom = new Map(plain.map((c) => [c.id, c.from]));
  for (const [from, group] of groupByFrom(plain.map((c) => c.id), plainFrom)) {
    for (const id of await setCategory(db, userId, group, [category], from)) restored.push({ id, category: from });
  }
  return {
    status: 200,
    body: { restored: restored.length, left_alone: changes.length - restored.length, restored_rows: restored },
  };
}
