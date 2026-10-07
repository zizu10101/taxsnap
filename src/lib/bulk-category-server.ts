import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { resolveExistingCategory } from "./expense-categories.ts";
import {
  BULK_CATEGORY_MAX,
  cleanChanges,
  cleanIds,
  isMeals,
  planBulkCategory,
  type BulkRow,
} from "./bulk-category.ts";

// The server half of the Expenses page's bulk "Change category". It writes ONE column,
// `tax_category`: never tax_amount, never anything else, and it never learns a vendor rule. Three
// modes behind one route (the route file only authenticates and forwards):
//
//   preview  {mode:"preview", ids, category}      dry run: the plan, nothing written
//   apply    {mode:"apply", category, changes, confirm_meals?}
//                                                  `changes` is what the preview returned
//                                                  ([{id, from}]); every row must STILL be in its
//                                                  `from` category or nothing is written
//                                                  (409 STALE_PREVIEW)
//   undo     {mode:"undo", category, changes}      puts rows back, but only those still in
//                                                  `category` (one edited since is left alone)
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

async function loadRows(db: Db, userId: string, ids: string[]): Promise<BulkRow[]> {
  const rows: BulkRow[] = [];
  for (let i = 0; i < ids.length; i += SLICE) {
    const { data, error } = await db
      .from("receipts")
      .select("id, tax_category, total_amount, tax_amount")
      .eq("user_id", userId)
      .in("id", ids.slice(i, i + SLICE));
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
  }
  return rows;
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
      const rows = await loadRows(db, userId, ids);
      return { status: 200, body: { category, plan: planBulkCategory(ids, rows, category) } };
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

    if (mode === "undo") {
      // Only rows still sitting in the category they were moved to are put back.
      const stillThere = ids.filter((id) => current.get(id) === category);
      const restored: { id: string; category: string }[] = [];
      for (const [from, group] of groupByFrom(stillThere, fromOf)) {
        const target = await resolveExistingCategory(db, userId, from);
        if (!target) continue;
        for (const id of await setCategory(db, userId, group, [category], target)) {
          restored.push({ id, category: target });
        }
      }
      return {
        status: 200,
        body: { restored: restored.length, left_alone: ids.length - restored.length, restored_rows: restored },
      };
    }

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

    const fromCategories = [...new Set(changes.map((c) => c.from))];
    const changed = await setCategory(db, userId, ids, fromCategories, category);
    if (changed.length !== ids.length) {
      // A row slipped out from under us between the check and the write: put back what moved.
      for (const [from, group] of groupByFrom(changed, fromOf)) {
        await setCategory(db, userId, group, [category], from);
      }
      return fail(409, "Some expenses changed while saving. Nothing was changed - preview again.", "STALE_PREVIEW");
    }
    return { status: 200, body: { category, changed: changed.length, previous: changes } };
  } catch (err) {
    return fail(500, err instanceof Error ? err.message : "Something went wrong.");
  }
}
