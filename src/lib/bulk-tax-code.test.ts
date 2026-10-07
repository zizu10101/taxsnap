import assert from "node:assert/strict";
import test from "node:test";
import { cleanTaxChanges, planBulkTaxCode, type TaxBulkRow } from "./bulk-tax-code.ts";
import { calculateHSTReturn } from "./hst.ts";
import { computeExpenseSummary } from "./expense-summary.ts";
import { drawerTaxCode, hasTypedFigure, samePatch, taxPatchForCode, TAX_CODES } from "./tax-codes.ts";

// "Set tax code" applies a code AFTER an expense is saved - but only to CALCULATED rows (a statement
// expense with no receipt attached). It must never touch a receipt's actual tax, a confirmed row, or
// a figure the owner typed, and the preview says how many were skipped and why.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = (n: number, over: Partial<TaxBulkRow> = {}): TaxBulkRow => ({
  id: id(n),
  tax_category: "Supplies",
  total_amount: 113,
  tax_amount: 0,
  ...over,
});
// A statement expense with no receipt and no code: "needs a tax code".
const uncoded = (n: number, over: Partial<TaxBulkRow> = {}) => base(n, { from_statement: true, no_receipt: true, ...over });
const scanned = (n: number, over: Partial<TaxBulkRow> = {}) => base(n, { tax_amount: 13, ...over });
const attached = (n: number, over: Partial<TaxBulkRow> = {}) => base(n, { from_statement: true, no_receipt: false, tax_amount: 13, ...over });

test("tax-included maths: $113 gets $13 at 13%, a Meals code stores the full tax with half claimable, refunds are credits", () => {
  const plan = planBulkTaxCode([id(1), id(2)], [uncoded(1), uncoded(2, { total_amount: -113 })], "taxable");
  const byId = Object.fromEntries(plan.retax.map((r) => [r.id, r.patch]));
  assert.deepEqual(byId[id(1)], { tax_amount: 13, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" });
  assert.equal(byId[id(2)].tax_amount, -13);
  const meals = planBulkTaxCode([id(1)], [uncoded(1, { total_amount: 565 })], "meals").retax[0].patch;
  assert.deepEqual([meals.tax_amount, meals.itc_pct, meals.deductible_pct], [65, 0.5, 0.5]);
  const none = planBulkTaxCode([id(1)], [uncoded(1)], "none").retax[0].patch;
  assert.deepEqual([none.tax_amount, none.tax_rate, none.itc_pct, none.deductible_pct], [0, 0, 0, 1]);
});

test("a receipt-attached row and a confirmed row are NEVER touched, and the preview says why", () => {
  const rows = [uncoded(1), attached(2), scanned(3), scanned(4, { from_statement: false, no_receipt: false })];
  const plan = planBulkTaxCode(rows.map((r) => r.id), rows, "none");
  assert.equal(plan.will_change, 1);
  assert.deepEqual(plan.changes.map((c) => c.id), [id(1)]);
  assert.deepEqual(plan.skipped, { has_receipt: 1, confirmed: 2, typed_figure: 0, already_set: 0 });
  assert.ok(!plan.retax.some((r) => [id(2), id(3), id(4)].includes(r.id)), "no new tax computed for them");
});

test("a row whose tax the owner typed (a refund slip's HST) is skipped, not overwritten", () => {
  const typed = uncoded(1, { total_amount: -113, tax_amount: -9.5 });
  assert.equal(hasTypedFigure(typed), true);
  const plan = planBulkTaxCode([id(1)], [typed], "taxable");
  assert.equal(plan.will_change, 0);
  assert.equal(plan.skipped.typed_figure, 1);
});

test("a row that already has exactly this code is skipped; a different code on it is changed", () => {
  const has = uncoded(1, { tax_amount: 13, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" });
  assert.equal(planBulkTaxCode([id(1)], [has], "taxable").skipped.already_set, 1);
  const plan = planBulkTaxCode([id(1)], [has], "meals");
  assert.equal(plan.will_change, 1);
  assert.deepEqual(plan.changes[0].prev, { tax_amount: 13, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" });
});

test("a code that came from the category's default is replaced by the owner's pick (and marked 'line')", () => {
  const byCategory = uncoded(1, { tax_amount: 0, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "category" });
  const plan = planBulkTaxCode([id(1)], [byCategory], "taxable");
  assert.equal(plan.will_change, 1);
  assert.equal(plan.retax[0].patch.tax_source, "line");
});

test("counts: missing ids, duplicates once, and how many had no code at all", () => {
  const rows = [uncoded(1), uncoded(2, { tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "kind" })];
  const plan = planBulkTaxCode([id(1), id(1), id(2), id(9)], rows, "taxable");
  assert.equal(plan.requested, 3);
  assert.equal(plan.missing, 1);
  assert.equal(plan.will_change, 2);
  assert.equal(plan.were_missing_a_code, 1, "only row 1 had no code; row 2 had a no-tax code");
});

// ---- the Line 106 split updates --------------------------------------------------------

test("Line 106: setting a code moves ITC into the CALCULATED part, clears 'needs a tax code', and leaves the confirmed part exactly alone", () => {
  const rows: TaxBulkRow[] = [scanned(1), attached(2), uncoded(3), uncoded(4, { total_amount: 226 })];
  const before = calculateHSTReturn(0, [], rows);
  assert.deepEqual(
    [before.line106Confirmed, before.line106Calculated, before.needsTaxCodeCount, before.line106],
    [26, 0, 2, 26],
  );

  const plan = planBulkTaxCode(rows.map((r) => r.id), rows, "taxable");
  assert.equal(plan.will_change, 2, "only the two uncoded statement rows");
  const patched = rows.map((r) => {
    const p = plan.retax.find((x) => x.id === r.id);
    return p ? { ...r, ...p.patch } : r;
  });
  const after = calculateHSTReturn(0, [], patched);
  assert.equal(after.line106Confirmed, 26, "confirmed ITCs unchanged to the cent");
  assert.equal(after.line106Calculated, 39, "$13 + $26 now calculated");
  assert.equal(after.needsTaxCodeCount, 0);
  assert.equal(after.line106, 65, "included by default");
  // with the toggle off, Line 106 is the receipt-backed figure alone, before and after
  assert.equal(calculateHSTReturn(0, [], patched, { includeCalculated: false }).line106, 26);
  // and the preview's own numbers say the same thing
  assert.equal(plan.effect.est_hst_reclaimable.before, 0);
  assert.equal(plan.effect.est_hst_reclaimable.after, 39);
  assert.equal(plan.effect.tax.after, 39);
  assert.equal(computeExpenseSummary(patched).estHstCalculated, 39);
});

test("a Meals code adds only half of its tax to the claimable ITC; a no-tax code adds none", () => {
  const rows = [uncoded(1, { total_amount: 565 }), uncoded(2)];
  const meals = planBulkTaxCode([id(1)], rows, "meals");
  assert.equal(meals.effect.tax.after, 65);
  assert.equal(meals.effect.est_hst_reclaimable.after, 32.5);
  const none = planBulkTaxCode([id(2)], rows, "none");
  assert.deepEqual([none.effect.tax.after, none.effect.est_hst_reclaimable.after], [0, 0]);
});

// ---- the drawer's rule ---------------------------------------------------------------

test("the drawer: a code is accepted for a calculated row, recalculated from the total being saved", () => {
  const r = drawerTaxCode(uncoded(1), 226, "taxable");
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.patch, { tax_amount: 26, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" });
  // clearing the code: no tax, needs a code again
  const cleared = drawerTaxCode(uncoded(1, { tax_amount: 13, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "line" }), 113, null);
  assert.deepEqual(cleared.ok && cleared.patch, { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null });
});

test("the drawer: refused for a receipt-attached row, a scanned receipt, an entered expense, or a missing row", () => {
  for (const row of [attached(1), scanned(1), base(1, { from_statement: false, no_receipt: false })]) {
    const r = drawerTaxCode(row, 113, "taxable");
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /statement expense that has no receipt/);
  }
  assert.equal(drawerTaxCode(null, 113, "taxable").ok, false);
  assert.match(!drawerTaxCode(uncoded(1), 113, "gst5").ok ? (drawerTaxCode(uncoded(1), 113, "gst5") as { error: string }).error : "", /Unknown tax code/);
});

test("taxPatchForCode / samePatch: equal only when every field matches", () => {
  assert.equal(samePatch(taxPatchForCode(113, "taxable"), taxPatchForCode(113, "taxable")), true);
  assert.equal(samePatch(taxPatchForCode(113, "taxable"), taxPatchForCode(226, "taxable")), false);
  assert.equal(samePatch(taxPatchForCode(113, "taxable"), taxPatchForCode(113, "meals")), false);
  assert.equal(taxPatchForCode(113, "none").tax_rate, TAX_CODES.none.tax_rate);
});

test("cleanTaxChanges requires a uuid and a whole previous tax state for every row", () => {
  const prev = { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null };
  assert.deepEqual(cleanTaxChanges([{ id: id(1), prev }])?.[0].prev, prev);
  assert.equal(cleanTaxChanges([{ id: id(1) }]), null);
  assert.equal(cleanTaxChanges([{ id: "x", prev }]), null);
  assert.equal(cleanTaxChanges([{ id: id(1), prev }, { id: id(1), prev }]), null);
  assert.equal(cleanTaxChanges([{ id: id(1), prev: { ...prev, tax_rate: 0.13 } }]), null, "half a code is refused");
  assert.equal(cleanTaxChanges("nope"), null);
});
