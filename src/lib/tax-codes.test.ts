import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCategoryDefaults,
  calculateTax,
  codeFromRow,
  codeKeyOf,
  deductiblePct,
  isCalculated,
  itcPct,
  needsTaxCode,
  resolveTaxCode,
  taxBasis,
  taxForLine,
  TAX_CODES,
  type ResolveInput,
} from "./tax-codes.ts";

// A tax code is three numbers (tax_rate, itc_pct, deductible_pct). Tax is EXTRACTED at tax_rate from
// the tax-included price, and the claim share is applied when read - which is why Meals needs three
// numbers: 13% is still in the price, only half is claimable. A line with no code calculates nothing.

const defaults = buildCategoryDefaults({ bankChargesName: "Bank charges" });
const input = (over: Partial<ResolveInput> = {}): ResolveInput => ({
  foreignCurrency: false,
  category: "Supplies",
  kind: "purchase",
  defaults,
  ...over,
});

// ---- the arithmetic ---------------------------------------------------------

test("tax-included: $113.00 contains $13.00 of 13% HST; $100.00 contains $11.50", () => {
  assert.equal(calculateTax(113, TAX_CODES.taxable), 13);
  assert.equal(calculateTax(100, TAX_CODES.taxable), 11.5);
});

test("rounding to the cent, including awkward small amounts", () => {
  assert.equal(calculateTax(0.38, TAX_CODES.taxable), 0.04);
  assert.equal(calculateTax(8.7, TAX_CODES.taxable), 1);
  assert.equal(calculateTax(0.01, TAX_CODES.taxable), 0);
  assert.equal(calculateTax(0.05, TAX_CODES.taxable), 0.01);
  assert.equal(calculateTax(1234.56, TAX_CODES.taxable), 142.03);
});

test("a refund's tax is negative, the same size as the original purchase's", () => {
  assert.equal(calculateTax(-113, TAX_CODES.taxable), -13);
  assert.equal(calculateTax(-113, TAX_CODES.taxable), -calculateTax(113, TAX_CODES.taxable));
});

test("no tax is exactly 0 - never -0 and never a rounding crumb", () => {
  assert.ok(Object.is(calculateTax(113, TAX_CODES.none), 0));
  assert.ok(Object.is(calculateTax(-113, TAX_CODES.none), 0));
  assert.ok(Object.is(calculateTax(-0.01, TAX_CODES.taxable), 0));
});

test("Meals: the tax is extracted at 13% (the full $13.00 is stored), then only half is claimable", () => {
  const tax = calculateTax(113, TAX_CODES.meals);
  assert.equal(tax, 13, "the stored tax is what is in the price, not the claimable part");
  assert.equal(tax * TAX_CODES.meals.itc_pct, 6.5);
  // A two-field design (rate 50%) would have produced 113 * .5 / 1.5 = 37.67. Meals is why there are three.
  assert.notEqual(calculateTax(113, { tax_rate: 0.5, itc_pct: 1, deductible_pct: 1 }), tax);
});

test("ITC and deductible are separate numbers: a no-tax expense is 0% claimable but 100% deductible", () => {
  assert.equal(TAX_CODES.none.itc_pct, 0);
  assert.equal(TAX_CODES.none.deductible_pct, 1);
  assert.equal(TAX_CODES.meals.deductible_pct, 0.5);
});

// ---- which code applies -------------------------------------------------------

test("only the bank charges category is seeded, and it follows the owner's name for it", () => {
  assert.deepEqual([...defaults.keys()], ["bank charges"]);
  assert.deepEqual(buildCategoryDefaults({ bankChargesName: null }).size, 0, "removed -> nothing seeded");
  const renamed = buildCategoryDefaults({ bankChargesName: "Bank fees" });
  assert.equal(resolveTaxCode(input({ category: "Bank fees", defaults: renamed }))?.source, "category");
  // Not seeded: every other category, including the ones the accountant has yet to rule on.
  for (const c of ["Meals", "Supplies", "Job Materials", "Insurance", "Rent", "Phone", "Other", "Licences"]) {
    assert.equal(resolveTaxCode(input({ category: c })), null, `${c} has no default code`);
  }
});

test("a category with no default and an ordinary purchase: no code, so nothing is calculated", () => {
  assert.equal(resolveTaxCode(input()), null);
  const t = taxForLine(113, input());
  assert.deepEqual(t, { tax_amount: 0, code: null, source: null, needs_code: true });
});

test("no category chosen yet: no code either (the suggestion doesn't count until accepted)", () => {
  assert.equal(resolveTaxCode(input({ category: null })), null);
});

test("fees and interest are no-tax by kind, whatever category they end up in", () => {
  for (const kind of ["fee", "interest"]) {
    const r = resolveTaxCode(input({ kind, category: "Supplies" }));
    assert.equal(r?.source, "kind");
    assert.equal(r?.code, TAX_CODES.none);
  }
  assert.equal(resolveTaxCode(input({ kind: "refund" })), null, "a refund has no kind default");
});

test("bank charges category: no tax even on a purchase-type line", () => {
  const r = resolveTaxCode(input({ category: "Bank charges" }));
  assert.deepEqual([r?.source, r?.code], ["category", TAX_CODES.none]);
});

test("foreign currency defaults to no tax, ahead of a category or kind default", () => {
  const r = resolveTaxCode(input({ foreignCurrency: true, category: "Bank charges", kind: "fee" }));
  assert.equal(r?.source, "foreign_currency");
  assert.equal(calculateTax(113, r!.code), 0);
});

test("precedence: line beats rule beats foreign beats category beats kind", () => {
  const all = input({ foreignCurrency: true, category: "Bank charges", kind: "fee" });
  assert.equal(resolveTaxCode({ ...all, override: TAX_CODES.taxable, rule: TAX_CODES.meals })?.source, "line");
  assert.equal(resolveTaxCode({ ...all, rule: TAX_CODES.taxable })?.source, "rule");
  assert.equal(resolveTaxCode({ ...all, rule: TAX_CODES.taxable })?.code, TAX_CODES.taxable, "a vendor rule can say a foreign vendor DID charge tax");
  assert.equal(resolveTaxCode(all)?.source, "foreign_currency");
  assert.equal(resolveTaxCode({ ...all, foreignCurrency: false })?.source, "category");
  assert.equal(resolveTaxCode({ ...all, foreignCurrency: false, category: "Supplies" })?.source, "kind");
});

test("a code chosen on the line is applied and calculated", () => {
  const t = taxForLine(565, input({ override: TAX_CODES.meals }));
  assert.equal(t.tax_amount, 65);
  assert.equal(t.source, "line");
  assert.equal(t.needs_code, false);
});

test("a refund is calculated with the same code, as a credit", () => {
  const t = taxForLine(-113, input({ override: TAX_CODES.taxable, kind: "refund" }));
  assert.equal(t.tax_amount, -13);
});

test("a refund's typed HST is kept, never overwritten by the calculation", () => {
  const t = taxForLine(-113, input({ override: TAX_CODES.taxable, kind: "refund" }), -9.5);
  assert.equal(t.tax_amount, -9.5);
  assert.equal(t.code, TAX_CODES.taxable, "the code still supplies the claim share");
  // A typed figure on a refund with no code is still not 'needs a code': the owner supplied the number.
  assert.equal(taxForLine(-113, input({ kind: "refund" }), -9.5).needs_code, false);
  // Typing 0 means "calculate it", not "zero".
  assert.equal(taxForLine(-113, input({ override: TAX_CODES.taxable, kind: "refund" }), 0).tax_amount, -13);
});

// ---- reading an expense row -----------------------------------------------------

test("a row with no code behaves exactly as before: Meals 50%, everything else 100%", () => {
  assert.equal(itcPct({ tax_category: "Meals" }), 0.5);
  assert.equal(itcPct({ tax_category: "Supplies" }), 1);
  assert.equal(deductiblePct({ tax_category: "Meals" }), 0.5);
  assert.equal(deductiblePct({ tax_category: "Custom thing" }), 1);
});

test("a row's own code wins over the category: ITC and deductible are read separately", () => {
  assert.equal(itcPct({ tax_category: "Supplies", itc_pct: 0 }), 0, "no-tax code on an ordinary category");
  assert.equal(deductiblePct({ tax_category: "Supplies", deductible_pct: 1 }), 1);
  assert.equal(itcPct({ tax_category: "Meals", itc_pct: 1 }), 1, "an explicit code outranks the category name");
  assert.equal(itcPct({ tax_category: "Supplies", itc_pct: 0.5, deductible_pct: 1 }), 0.5);
  assert.equal(deductiblePct({ tax_category: "Supplies", itc_pct: 0.5, deductible_pct: 1 }), 1);
});

test("calculated vs confirmed: statement expense with no receipt is calculated; everything else is confirmed", () => {
  assert.equal(taxBasis({ from_statement: true, no_receipt: true }), "calculated");
  assert.equal(taxBasis({ from_statement: true, no_receipt: false }), "confirmed", "a receipt was attached");
  assert.equal(taxBasis({ from_statement: false, no_receipt: false }), "confirmed", "a scanned or manually typed expense");
  assert.equal(taxBasis({}), "confirmed", "rows from before statement import");
  assert.equal(isCalculated({ from_statement: null, no_receipt: null }), false);
});

test("needs a tax code: calculated, no code, nothing typed - and only then", () => {
  const base = { from_statement: true, no_receipt: true, tax_rate: null, tax_amount: 0 };
  assert.equal(needsTaxCode(base), true);
  assert.equal(needsTaxCode({ ...base, tax_rate: 0 }), false, "a no-tax code is a code");
  assert.equal(needsTaxCode({ ...base, tax_amount: -9.5 }), false, "a typed refund figure");
  assert.equal(needsTaxCode({ ...base, no_receipt: false }), false, "a receipt was attached: confirmed");
  assert.equal(needsTaxCode({ ...base, from_statement: false, no_receipt: false }), false);
});

test("codeFromRow is all-or-none, and codeKeyOf names the known codes", () => {
  assert.equal(codeFromRow({}), null);
  assert.equal(codeFromRow({ tax_rate: 0.13, itc_pct: 1 }), null);
  const c = codeFromRow({ tax_rate: 0.13, itc_pct: 0.5, deductible_pct: 0.5 });
  assert.deepEqual(c, TAX_CODES.meals);
  assert.equal(codeKeyOf(c), "meals");
  assert.equal(codeKeyOf({ tax_rate: 0.15, itc_pct: 1, deductible_pct: 1 }), null);
  assert.equal(codeKeyOf(null), null);
  // numeric columns can arrive as strings from some drivers
  assert.deepEqual(codeFromRow({ tax_rate: "0.1300" as unknown as number, itc_pct: 1, deductible_pct: 1 }), TAX_CODES.taxable);
});

// ---- a calculated row follows its category; nothing else does ---------------------------

import { taxAfterCategoryChange } from "./tax-codes.ts";

const calcRow = (over: Record<string, unknown> = {}) => ({
  total_amount: 113,
  tax_amount: 0,
  from_statement: true,
  no_receipt: true,
  tax_rate: 0,
  itc_pct: 0,
  deductible_pct: 1,
  tax_source: "category" as const,
  ...over,
});

test("a calculated row coded by its category loses the code (and any calculated tax) when it moves to a category with no default", () => {
  const p = taxAfterCategoryChange(calcRow(), "Supplies", defaults);
  assert.deepEqual(p, { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null });
});

test("an UNCODED calculated row does not gain a code by moving into a category that has a default", () => {
  // Only a row whose code came from its category follows a category change.
  const uncoded = calcRow({ tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null });
  assert.equal(taxAfterCategoryChange(uncoded, "Bank charges", defaults), null);
});

test("a category default that calculates tax recomputes the tax from the row's total", () => {
  const withTaxable = new Map([["supplies", TAX_CODES.taxable]]);
  const p = taxAfterCategoryChange(calcRow(), "Supplies", withTaxable);
  assert.deepEqual(p, { tax_amount: 13, tax_rate: 0.13, itc_pct: 1, deductible_pct: 1, tax_source: "category" });
  // and a refund's tax is a credit
  assert.equal(taxAfterCategoryChange(calcRow({ total_amount: -113 }), "Supplies", withTaxable)?.tax_amount, -13);
});

test("a confirmed row is NEVER touched, whatever its code says", () => {
  assert.equal(taxAfterCategoryChange(calcRow({ no_receipt: false }), "Supplies", defaults), null, "receipt attached");
  assert.equal(taxAfterCategoryChange(calcRow({ from_statement: false, no_receipt: false }), "Supplies", defaults), null);
  assert.equal(taxAfterCategoryChange({ total_amount: 113, tax_amount: 13 }, "Meals", defaults), null, "an ordinary scanned receipt");
});

test("a code the owner picked, a vendor rule's, or a fee/foreign default does not follow the category", () => {
  for (const tax_source of ["line", "rule", "kind", "foreign_currency"] as const) {
    assert.equal(taxAfterCategoryChange(calcRow({ tax_source }), "Supplies", defaults), null, tax_source);
  }
});

test("a row with a typed refund figure and no code is left alone", () => {
  assert.equal(
    taxAfterCategoryChange(calcRow({ total_amount: -113, tax_amount: -9.5, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null }), "Supplies", defaults),
    null,
  );
});

test("no change needed returns null (nothing to write)", () => {
  const same = new Map([["bank charges", TAX_CODES.none]]);
  assert.equal(taxAfterCategoryChange(calcRow(), "Bank charges", same), null);
});
