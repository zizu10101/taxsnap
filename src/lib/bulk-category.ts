// Bulk "Change category" on the Expenses page: the pure rules, shared by the preview and the apply
// (the route runs the SAME planBulkCategory for both, so the preview can't promise something the
// apply then does differently).
//
// What a bulk change touches: `tax_category`, and - ONLY on a CALCULATED row (a card-statement
// expense with no receipt) whose tax code came from its category's default - that row's tax code
// and calculated tax, recomputed for the new category (taxAfterCategoryChange). A CONFIRMED row
// (a scanned or attached receipt, or a figure the owner typed) is never touched: its tax_amount
// stays exactly as it is.
//
// Even for a confirmed row one thing moves: how its sales tax is treated. "Meals" gets a 50%
// ITC/deductible rate and everything else 100% (itcPct/deductiblePct fall back to the category), so
// moving $65 of HST into or out of Meals changes the estimated reclaimable HST by $32.50 with no
// stored tax change. That is why Meals on either side needs its own confirmation, and why the plan
// reports the before/after effect.

import { computeExpenseSummary } from "./expense-summary.ts";
import { taxAfterCategoryChange, currentTaxPatch, TAX_SOURCES, type CategoryDefaults, type RecalcRow, type TaxPatch } from "./tax-codes.ts";

export const BULK_CATEGORY_MAX = 500;

export interface BulkRow extends RecalcRow {
  id: string;
  tax_category: string;
  total_amount: number;
  tax_amount: number;
}

export interface BulkChange {
  id: string;
  /** The category the row had when it was previewed - apply refuses if it has changed since. */
  from: string;
  /** The row's tax code and tax BEFORE the change, present only when the change recalculates it
   *  (so undo can restore it). Always recomputed server-side on apply; never trusted from a client. */
  prev?: TaxPatch;
}

export interface CategoryGroup {
  category: string;
  count: number;
  total: number;
}

export interface BulkPlan {
  /** Distinct ids asked about. */
  requested: number;
  /** Ids that aren't (or are no longer) this person's expenses. */
  missing: number;
  /** Already in the target category - left alone. */
  already_in_target: number;
  will_change: number;
  /** Sum of total_amount over the rows that will change (as paid, HST included). */
  moved_total: number;
  by_category: CategoryGroup[];
  /** The rows that will change, each with the category it is being moved FROM. */
  changes: BulkChange[];
  /** Calculated statement expenses whose tax code and calculated tax are recomputed by this move. */
  recalculated: number;
  /** Confirmed rows are never recalculated; how many of the moving rows are confirmed. */
  confirmed_untouched: number;
  /** The new tax for each recalculated row (server-side use; recomputed on apply). */
  retax: { id: string; patch: TaxPatch }[];
  /** Meals is the source or the target of at least one changing row. */
  meals_involved: boolean;
  /** Estimated effect over just the changing rows. */
  effect: {
    est_hst_reclaimable: { before: number; after: number };
    deductible_spend: { before: number; after: number };
  };
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
export const isMeals = (category: string) => category === "Meals";

export function planBulkCategory(
  ids: string[],
  rows: BulkRow[],
  target: string,
  defaults: CategoryDefaults = new Map(),
): BulkPlan {
  const wanted = [...new Set(ids)];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const found = wanted.map((id) => byId.get(id)).filter((r): r is BulkRow => !!r);
  const changing = found.filter((r) => !same(r.tax_category, target));

  const groups = new Map<string, CategoryGroup>();
  for (const r of changing) {
    const g = groups.get(r.tax_category) ?? { category: r.tax_category, count: 0, total: 0 };
    g.count += 1;
    g.total = round2(g.total + r.total_amount);
    groups.set(r.tax_category, g);
  }

  // Calculated rows whose code follows their category are recomputed; nothing else is.
  const retax = new Map<string, TaxPatch>();
  for (const r of changing) {
    const patch = taxAfterCategoryChange(r, target, defaults);
    if (patch) retax.set(r.id, patch);
  }

  const before = computeExpenseSummary(changing);
  const after = computeExpenseSummary(
    changing.map((r) => ({ ...r, tax_category: target, ...(retax.get(r.id) ?? {}) })),
  );

  return {
    requested: wanted.length,
    missing: wanted.length - found.length,
    already_in_target: found.length - changing.length,
    will_change: changing.length,
    moved_total: round2(changing.reduce((s, r) => s + r.total_amount, 0)),
    by_category: [...groups.values()].sort((a, b) => b.total - a.total),
    changes: changing.map((r) => ({
      id: r.id,
      from: r.tax_category,
      ...(retax.has(r.id) && { prev: currentTaxPatch(r) }),
    })),
    recalculated: retax.size,
    confirmed_untouched: changing.filter((r) => !(r.from_statement === true && r.no_receipt === true)).length,
    retax: [...retax].map(([id, patch]) => ({ id, patch })),
    meals_involved: changing.length > 0 && (isMeals(target) || changing.some((r) => isMeals(r.tax_category))),
    effect: {
      est_hst_reclaimable: { before: before.estHstReclaimable, after: after.estHstReclaimable },
      deductible_spend: { before: before.deductibleSpend, after: after.deductibleSpend },
    },
  };
}

// Same-shape check used by apply and undo: ids look like uuids and the list is a sane size.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function cleanIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  // A repeated id is refused rather than silently merged, so a client bug is loud.
  if (new Set(value).size !== value.length) return null;
  if (value.some((id) => typeof id !== "string" || !UUID.test(id))) return null;
  return value as string[];
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown): v is number | null => v === null || isNum(v);

// A previous tax state echoed back for undo: only the exact shape, nothing else.
export function cleanTaxPatch(value: unknown): TaxPatch | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isNum(v.tax_amount) || !numOrNull(v.tax_rate) || !numOrNull(v.itc_pct) || !numOrNull(v.deductible_pct)) return null;
  const source = v.tax_source;
  if (source !== null && !TAX_SOURCES.includes(source as never)) return null;
  const allNull = v.tax_rate === null && v.itc_pct === null && v.deductible_pct === null && source === null;
  const allSet = v.tax_rate !== null && v.itc_pct !== null && v.deductible_pct !== null && source !== null;
  if (!allNull && !allSet) return null;
  for (const n of [v.tax_rate, v.itc_pct, v.deductible_pct]) if (n !== null && ((n as number) < 0 || (n as number) > 1)) return null;
  return {
    tax_amount: v.tax_amount,
    tax_rate: v.tax_rate as number | null,
    itc_pct: v.itc_pct as number | null,
    deductible_pct: v.deductible_pct as number | null,
    tax_source: source as TaxPatch["tax_source"],
  };
}

export function cleanChanges(value: unknown): BulkChange[] | null {
  if (!Array.isArray(value)) return null;
  const out: BulkChange[] = [];
  for (const c of value) {
    if (!c || typeof c.id !== "string" || typeof c.from !== "string" || !UUID.test(c.id) || !c.from.trim()) return null;
    const change: BulkChange = { id: c.id, from: c.from };
    if (c.prev !== undefined) {
      const prev = cleanTaxPatch(c.prev);
      if (!prev) return null;
      change.prev = prev;
    }
    out.push(change);
  }
  if (new Set(out.map((c) => c.id)).size !== out.length) return null;
  return out;
}
