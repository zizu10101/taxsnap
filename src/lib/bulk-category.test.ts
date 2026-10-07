import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BULK_CATEGORY_MAX,
  cleanChanges,
  cleanIds,
  planBulkCategory,
  type BulkRow,
} from "./bulk-category.ts";

// The pure rules behind bulk "Change category". The headline: only the category moves. Sales tax is
// untouched, but Meals is treated as 50% reclaimable, so moving HST into or out of Meals changes the
// ESTIMATED reclaimable HST - the preview must say by how much, and demand its own confirmation.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = (n: number, tax_category: string, total_amount: number, tax_amount: number): BulkRow => ({
  id: id(n),
  tax_category,
  total_amount,
  tax_amount,
});

test("Meals maths: moving $65 of HST out of Meals gains $32.50 reclaimable, with no tax figure changed", () => {
  const rows = [row(1, "Meals", 565, 65)];
  const plan = planBulkCategory([id(1)], rows, "Supplies");
  assert.equal(plan.effect.est_hst_reclaimable.before, 32.5);
  assert.equal(plan.effect.est_hst_reclaimable.after, 65);
  assert.equal(plan.effect.deductible_spend.before, 282.5);
  assert.equal(plan.effect.deductible_spend.after, 565);
  assert.equal(plan.meals_involved, true);
  // The plan describes a category move only: the rows' own figures are never part of what changes.
  assert.deepEqual(plan.changes, [{ id: id(1), from: "Meals" }]);
  assert.deepEqual(rows[0], row(1, "Meals", 565, 65), "the input rows are not modified");
});

test("Meals maths the other way: moving into Meals halves the reclaimable HST and the deductible spend", () => {
  const plan = planBulkCategory([id(1), id(2)], [row(1, "Supplies", 226, 26), row(2, "Fuel", 113, 13)], "Meals");
  assert.equal(plan.effect.est_hst_reclaimable.before, 39);
  assert.equal(plan.effect.est_hst_reclaimable.after, 19.5);
  assert.equal(plan.effect.deductible_spend.before, 339);
  assert.equal(plan.effect.deductible_spend.after, 169.5);
  assert.equal(plan.meals_involved, true);
});

test("no Meals on either side: no effect, and no extra confirmation needed", () => {
  const plan = planBulkCategory([id(1), id(2)], [row(1, "Supplies", 113, 13), row(2, "Fuel", 56.5, 6.5)], "Tools");
  assert.equal(plan.meals_involved, false);
  assert.equal(plan.effect.est_hst_reclaimable.before, plan.effect.est_hst_reclaimable.after);
  assert.equal(plan.effect.deductible_spend.before, plan.effect.deductible_spend.after);
});

test("Meals only matters when a row actually changes: Meals rows already in Meals don't trigger it", () => {
  const plan = planBulkCategory([id(1)], [row(1, "Meals", 113, 13)], "Meals");
  assert.equal(plan.will_change, 0);
  assert.equal(plan.meals_involved, false);
});

test("count and skip logic: rows already in the target are skipped, case-insensitively; missing ids are counted", () => {
  const rows = [row(1, "Supplies", 100, 0), row(2, "supplies", 50, 0), row(3, "Fuel", 30, 0)];
  const plan = planBulkCategory([id(1), id(2), id(3), id(4)], rows, "Supplies");
  assert.equal(plan.requested, 4);
  assert.equal(plan.will_change, 1);
  assert.equal(plan.already_in_target, 2);
  assert.equal(plan.missing, 1);
  assert.equal(plan.moved_total, 30);
  assert.deepEqual(plan.changes, [{ id: id(3), from: "Fuel" }]);
});

test("the table by current category adds up to what moves, biggest first", () => {
  const rows = [row(1, "Fuel", 40, 0), row(2, "Fuel", 60, 0), row(3, "Office", 150, 0), row(4, "Tools", 5, 0)];
  const plan = planBulkCategory(rows.map((r) => r.id), rows, "Supplies");
  assert.deepEqual(plan.by_category, [
    { category: "Office", count: 1, total: 150 },
    { category: "Fuel", count: 2, total: 100 },
    { category: "Tools", count: 1, total: 5 },
  ]);
  assert.equal(plan.moved_total, 255);
  assert.equal(plan.by_category.reduce((s, g) => s + g.total, 0), plan.moved_total);
});

test("duplicate ids are counted once", () => {
  const plan = planBulkCategory([id(1), id(1), id(1)], [row(1, "Fuel", 10, 0)], "Tools");
  assert.equal(plan.requested, 1);
  assert.equal(plan.will_change, 1);
});

test("refunds (negative totals) move like any other row and reduce the moved total", () => {
  const plan = planBulkCategory([id(1), id(2)], [row(1, "Fuel", 100, 0), row(2, "Fuel", -40, 0)], "Tools");
  assert.equal(plan.moved_total, 60);
});

test("cleanIds: only distinct uuids, as a list", () => {
  assert.deepEqual(cleanIds([id(1), id(2)]), [id(1), id(2)]);
  assert.equal(cleanIds("nope"), null);
  assert.equal(cleanIds([id(1), "not-a-uuid"]), null);
  assert.equal(cleanIds([id(1), id(1)]), null, "a repeated id is refused, not silently merged");
  assert.equal(cleanIds([id(1), 5]), null);
});

test("cleanChanges: each entry needs a uuid and the category it is moving from", () => {
  assert.deepEqual(cleanChanges([{ id: id(1), from: "Fuel" }]), [{ id: id(1), from: "Fuel" }]);
  assert.equal(cleanChanges([{ id: id(1) }]), null);
  assert.equal(cleanChanges([{ id: id(1), from: "  " }]), null);
  assert.equal(cleanChanges([{ id: "x", from: "Fuel" }]), null);
  assert.equal(cleanChanges([{ id: id(1), from: "Fuel" }, { id: id(1), from: "Tools" }]), null);
  assert.equal(cleanChanges(null), null);
});

test("the per-action cap is 500", () => {
  assert.equal(BULK_CATEGORY_MAX, 500);
});

// ---- calculated statement expenses follow their category; confirmed ones never do ----------

import { buildCategoryDefaults, TAX_CODES } from "./tax-codes.ts";
import { cleanTaxPatch } from "./bulk-category.ts";

const defaults = buildCategoryDefaults({ bankChargesName: "Bank charges" });
const calculated = (n: number, over: Partial<BulkRow> = {}): BulkRow => ({
  ...row(n, "Bank charges", 113, 0),
  from_statement: true,
  no_receipt: true,
  tax_rate: 0,
  itc_pct: 0,
  deductible_pct: 1,
  tax_source: "category",
  ...over,
});

test("a calculated row coded by its category is recomputed: out of the no-tax category it loses the code, and the plan says so", () => {
  const plan = planBulkCategory([id(1)], [calculated(1)], "Supplies", defaults);
  assert.equal(plan.recalculated, 1);
  assert.deepEqual(plan.retax, [
    { id: id(1), patch: { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null } },
  ]);
  // the change remembers the previous code and tax so Undo can put them back
  assert.deepEqual(plan.changes[0].prev, { tax_amount: 0, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "category" });
});

test("confirmed rows are never recalculated: not a scanned receipt, not an attached one, not a typed figure", () => {
  const rows = [
    row(1, "Bank charges", 113, 13), // an ordinary scanned receipt
    calculated(2, { no_receipt: false }), // a receipt was attached: now confirmed, stale code ignored
    calculated(3, { tax_source: "line", tax_rate: 0.13, itc_pct: 1 }), // the owner's own pick
  ];
  const plan = planBulkCategory(rows.map((r) => r.id), rows, "Supplies", defaults);
  assert.equal(plan.recalculated, 0);
  assert.deepEqual(plan.retax, []);
  assert.ok(plan.changes.every((c) => c.prev === undefined));
  assert.equal(plan.confirmed_untouched, 2, "the scanned and the attached rows");
});

test("a mix: only the calculated, category-coded row changes tax; the confirmed row keeps its tax_amount in the effect", () => {
  const withTaxable = new Map([["supplies", TAX_CODES.taxable]]);
  const rows = [calculated(1), row(2, "Fuel", 113, 13)];
  const plan = planBulkCategory([id(1), id(2)], rows, "Supplies", withTaxable);
  assert.equal(plan.recalculated, 1);
  assert.equal(plan.retax[0].patch.tax_amount, 13);
  // before: only the confirmed row's $13 ITC counts (the calculated row had tax 0); after: both do
  assert.equal(plan.effect.est_hst_reclaimable.before, 13);
  assert.equal(plan.effect.est_hst_reclaimable.after, 26);
});

test("cleanTaxPatch accepts exactly a whole tax state and nothing else", () => {
  assert.deepEqual(cleanTaxPatch({ tax_amount: 0, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "category" }), {
    tax_amount: 0,
    tax_rate: 0,
    itc_pct: 0,
    deductible_pct: 1,
    tax_source: "category",
  });
  assert.deepEqual(
    cleanTaxPatch({ tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null })?.tax_source,
    null,
  );
  // half a code, an unknown source, an out-of-range share, or junk
  assert.equal(cleanTaxPatch({ tax_amount: 0, tax_rate: 0.13, itc_pct: null, deductible_pct: null, tax_source: null }), null);
  assert.equal(cleanTaxPatch({ tax_amount: 0, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "magic" }), null);
  assert.equal(cleanTaxPatch({ tax_amount: 0, tax_rate: 7, itc_pct: 0, deductible_pct: 1, tax_source: "line" }), null);
  assert.equal(cleanTaxPatch("x"), null);
  assert.equal(cleanTaxPatch(null), null);
});

test("cleanChanges carries a valid previous tax state and refuses a malformed one", () => {
  const prev = { tax_amount: 0, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "category" };
  assert.deepEqual(cleanChanges([{ id: id(1), from: "Bank charges", prev }])?.[0].prev, prev);
  assert.equal(cleanChanges([{ id: id(1), from: "Bank charges", prev: { tax_amount: "x" } }]), null);
});
