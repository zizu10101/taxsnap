import assert from "node:assert/strict";
import test from "node:test";
import { isForeignLine, lineTax, manualTaxOf, taxWritesFor, type TaxLineInput } from "./statement-tax.ts";
import { buildCategoryDefaults, TAX_CODES } from "./tax-codes.ts";

// What a statement line is saved with, tax-wise: the owner's pick or typed figure if there is one,
// else a clear default (bank charges, fees and interest, foreign currency), else NOTHING - the line
// is flagged "needs a tax code" and no tax or ITC is invented.

const defaults = buildCategoryDefaults({ bankChargesName: "Bank charges" });
const line = (over: Partial<TaxLineInput> = {}): TaxLineInput => ({
  kind: "purchase",
  amount: 113,
  category: "Supplies",
  original_currency: null,
  tax_amount: 0,
  ...over,
});

test("an ordinary purchase in an ordinary category has no code: nothing is calculated, and it says so", () => {
  const t = lineTax(line(), defaults);
  assert.deepEqual([t.tax_amount, t.needs_code, t.code], [0, true, null]);
});

test("a code picked on the line is calculated at the line's amount", () => {
  const t = lineTax(line({ amount: 565, tax_source: "line", ...TAX_CODES.meals }), defaults);
  assert.equal(t.tax_amount, 65);
  assert.equal(t.source, "line");
  assert.equal(t.code?.itc_pct, 0.5);
});

test("changing the amount recalculates; nothing stale is stored on a draft", () => {
  const picked = { tax_source: "line" as const, ...TAX_CODES.taxable };
  assert.equal(lineTax(line({ amount: 113, ...picked }), defaults).tax_amount, 13);
  assert.equal(lineTax(line({ amount: 226, ...picked }), defaults).tax_amount, 26);
});

test("bank charges, fees and interest are no-tax by default; foreign currency too", () => {
  assert.equal(lineTax(line({ category: "Bank charges" }), defaults).source, "category");
  assert.equal(lineTax(line({ kind: "fee", amount: 12 }), defaults).source, "kind");
  assert.equal(lineTax(line({ kind: "interest", amount: 30 }), defaults).tax_amount, 0);
  const foreign = lineTax(line({ original_currency: "USD", amount: 80 }), defaults);
  assert.deepEqual([foreign.source, foreign.tax_amount, foreign.needs_code], ["foreign_currency", 0, false]);
  assert.equal(isForeignLine({ original_currency: "cad" }), false);
  assert.equal(isForeignLine({ original_currency: null }), false);
});

test("a no-tax default is a real code, so it is not 'needs a tax code'", () => {
  assert.equal(lineTax(line({ kind: "fee" }), defaults).needs_code, false);
});

test("a refund is calculated as a credit with the same code", () => {
  const t = lineTax(line({ kind: "refund", amount: -113, tax_source: "line", ...TAX_CODES.taxable }), defaults);
  assert.equal(t.tax_amount, -13);
});

test("a refund's typed HST figure is kept exactly, with no code, and is never overwritten", () => {
  const typed = line({ kind: "refund", amount: -113, tax_amount: -9.5 });
  assert.equal(manualTaxOf(typed), -9.5);
  const t = lineTax(typed, defaults);
  assert.deepEqual([t.tax_amount, t.code, t.source, t.manual, t.needs_code], [-9.5, null, null, true, false]);
  // It isn't 'manual' once a code has been resolved onto it (tax_source set) or on a non-refund.
  assert.equal(manualTaxOf(line({ kind: "refund", amount: -113, tax_amount: -13, tax_source: "category" })), null);
  assert.equal(manualTaxOf(line({ tax_amount: 5 })), null);
});

// ---- what is written just before commit ----------------------------------------------

const row = (id: string, over: Partial<TaxLineInput & { resolution: string | null }> = {}) => ({
  id,
  resolution: "new_expense" as string | null,
  ...line(),
  ...over,
});

test("only lines that become expenses are written, and only when something differs", () => {
  const writes = taxWritesFor(
    [
      row("fee", { kind: "fee", amount: 12 }),
      row("skipped", { kind: "fee", resolution: "skipped" }),
      row("matched", { kind: "purchase", resolution: "matched" }),
      row("plain"),
    ],
    defaults,
  );
  const byId = Object.fromEntries(writes.map((w) => [w.id, w.update]));
  assert.deepEqual(Object.keys(byId), ["fee"], "an uncoded line stays uncoded (already null/0); skipped and matched lines are untouched");
  assert.deepEqual(byId.fee, { tax_amount: 0, tax_rate: 0, itc_pct: 0, deductible_pct: 1, tax_source: "kind" });
});

test("a picked code is materialized with its calculated tax; running again writes nothing", () => {
  const picked = row("a", { amount: 565, tax_source: "line", ...TAX_CODES.meals });
  const first = taxWritesFor([picked], defaults);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0].update, { tax_amount: 65, tax_rate: 0.13, itc_pct: 0.5, deductible_pct: 0.5, tax_source: "line" });
  const again = taxWritesFor([{ ...picked, ...first[0].update }], defaults);
  assert.deepEqual(again, [], "idempotent: a retry after a failed commit changes nothing");
});

test("a derived code is recomputed if the category changed since the last attempt", () => {
  const first = taxWritesFor([row("a", { category: "Bank charges" })], defaults)[0];
  assert.equal(first.update.tax_source, "category");
  // Same line, now in a category with no default, but carrying the derived code from the last attempt.
  const next = taxWritesFor([row("a", { category: "Supplies", ...first.update })], defaults)[0];
  assert.deepEqual(next.update, { tax_amount: 0, tax_rate: null, itc_pct: null, deductible_pct: null, tax_source: null });
});

test("a typed refund figure is never rewritten", () => {
  assert.deepEqual(taxWritesFor([row("r", { kind: "refund", amount: -113, tax_amount: -9.5 })], defaults), []);
});
