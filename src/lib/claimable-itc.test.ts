import assert from "node:assert/strict";
import test from "node:test";
import { calculateHSTReturn } from "./hst.ts";
import { computeExpenseSummary } from "./expense-summary.ts";
import { claimableItc, round2, TAX_CODES, type TaxCodeKey } from "./tax-codes.ts";

// The drawer's "Claimable ITC: $x" and Line 106 / the Overview's "Est. HST reclaimable" are one number:
// claimableItc() rounds with the same round2 the reports use, so for any one expense they agree to the
// cent - a half cent rounds UP in all three.

const statementRow = (tax_amount: number, key: TaxCodeKey, over: Record<string, unknown> = {}) => ({
  total_amount: tax_amount * 8.7,
  tax_amount,
  tax_category: "Supplies",
  from_statement: true,
  no_receipt: true,
  ...TAX_CODES[key],
  tax_source: "line" as const,
  ...over,
});

test("the drawer's figure, per code: Meals half, Taxable all, No tax $0.00", () => {
  assert.equal(claimableItc(statementRow(43.23, "meals")), 21.62);
  assert.equal(claimableItc(statementRow(43.23, "taxable")), 43.23);
  assert.equal(claimableItc(statementRow(43.23, "none")), 0);
  assert.equal(claimableItc(statementRow(65, "meals")), 32.5);
});

test("the half-cent case: $43.23 of tax at 50% is 21.615 and rounds UP to $21.62 (not 21.61)", () => {
  assert.equal(43.23 * 0.5, 21.615);
  assert.equal(claimableItc(statementRow(43.23, "meals")), 21.62);
  assert.equal(claimableItc(statementRow(0.05, "meals")), 0.03, "0.025 rounds up too");
  assert.equal(claimableItc(statementRow(1.01, "meals")), 0.51, "0.505 rounds up too");
});

test("the drawer, Line 106 and the Overview's Est. HST reclaimable agree to the cent for one expense - every code, awkward amounts included", () => {
  const taxes = [0, 0.01, 0.05, 1.01, 2.675, 6.5, 13, 21.61, 43.23, 65, 142.03, 999.99, 1234.57];
  for (const key of Object.keys(TAX_CODES) as TaxCodeKey[]) {
    for (const tax of taxes) {
      const row = statementRow(tax, key);
      const drawer = claimableItc(row);
      assert.equal(calculateHSTReturn(0, [], [row]).line106, drawer, `Line 106, ${key} @ ${tax}`);
      assert.equal(computeExpenseSummary([row]).estHstReclaimable, drawer, `Overview, ${key} @ ${tax}`);
      // and it sits in the CALCULATED part of the split, not the confirmed one
      assert.equal(computeExpenseSummary([row]).estHstCalculated, drawer);
      assert.equal(computeExpenseSummary([row]).estHstConfirmed, 0);
    }
  }
});

test("the reports and the drawer round with literally the same function", () => {
  // round2 is the one exported by tax-codes.ts; hst.ts and expense-summary.ts import it (no private copies).
  for (const n of [21.615, 0.025, 0.505, 2.675, 1.005, 10.8049999, -21.615]) {
    assert.equal(claimableItc({ tax_amount: n * 2, tax_category: "Meals" }), round2(n * 2 * 0.5));
  }
});

// ---- the Overview: Meals tax counts half for statement expenses -----------------------------------

test("Overview 'Est. HST reclaimable': a statement expense coded Meals counts HALF its tax", () => {
  const meals = statementRow(65, "meals", { tax_category: "Meals", total_amount: 565 });
  const s = computeExpenseSummary([meals]);
  assert.equal(s.estHstReclaimable, 32.5);
  assert.equal(s.estHstCalculated, 32.5, "counted in the calculated part");
  assert.equal(s.deductibleSpend, 282.5, "and the spend is 50% deductible");
});

test("Overview: a Meals-coded statement expense mixed with a scanned Meals receipt - both count half", () => {
  const scannedMeals = { total_amount: 565, tax_amount: 65, tax_category: "Meals" };
  const stmtMeals = statementRow(65, "meals", { tax_category: "Meals", total_amount: 565 });
  const s = computeExpenseSummary([scannedMeals, stmtMeals]);
  assert.equal(s.estHstConfirmed, 32.5);
  assert.equal(s.estHstCalculated, 32.5);
  assert.equal(s.estHstReclaimable, 65);
});

test("Overview: a statement expense in the Meals category with NO code counts nothing (needs a tax code, tax 0)", () => {
  const needsCode = { total_amount: 565, tax_amount: 0, tax_category: "Meals", from_statement: true, no_receipt: true };
  const s = computeExpenseSummary([needsCode]);
  assert.equal(s.estHstReclaimable, 0);
  assert.equal(s.needsTaxCodeCount, 1);
});

test("a code the owner picks outranks the category name: Meals category + Taxable code claims the full tax", () => {
  // Deliberate: an explicit code on the expense is the owner's decision, so the category name no longer halves it.
  const row = statementRow(65, "taxable", { tax_category: "Meals", total_amount: 565 });
  assert.equal(claimableItc(row), 65);
  assert.equal(computeExpenseSummary([row]).estHstReclaimable, 65);
});
