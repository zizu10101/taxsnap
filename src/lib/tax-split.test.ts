import assert from "node:assert/strict";
import test from "node:test";
import { calculateHSTReturn } from "./hst.ts";
import { computeExpenseSummary } from "./expense-summary.ts";
import { itcSplitNote } from "./tax-codes.ts";
import { receiptsToCsv } from "./csv.ts";
import type { Receipt } from "./database.types.ts";

// The reports show what BACKS an ITC figure: receipts (confirmed) vs a calculation from a card
// statement (calculated). Line 106 includes calculated ITCs by default, with a toggle.

const scanned = (tax: number, category = "Supplies") => ({
  total_amount: tax * 8.7,
  tax_amount: tax,
  tax_category: category,
});
const calc = (tax: number, over: Record<string, unknown> = {}) => ({
  total_amount: tax * 8.7,
  tax_amount: tax,
  tax_category: "Supplies",
  from_statement: true,
  no_receipt: true,
  tax_rate: 0.13,
  itc_pct: 1,
  deductible_pct: 1,
  ...over,
});
const none = { total_amount: 40, tax_amount: 0, tax_category: "Supplies", from_statement: true, no_receipt: true };

test("with no statement expenses nothing changes: Meals 50%, everything else 100%, no split", () => {
  const lines = calculateHSTReturn(0, [], [scanned(10), scanned(20, "Meals")]);
  assert.equal(lines.line106, 20);
  assert.deepEqual([lines.line106Confirmed, lines.line106Calculated, lines.calculatedCount, lines.needsTaxCodeCount], [20, 0, 0, 0]);
});

test("Line 106 includes calculated ITCs by default, split into confirmed and calculated", () => {
  const lines = calculateHSTReturn(0, [], [scanned(10), calc(13)]);
  assert.equal(lines.line106, 23);
  assert.equal(lines.line106Confirmed, 10);
  assert.equal(lines.line106Calculated, 13);
  assert.equal(lines.calculatedCount, 1);
});

test("the toggle sets calculated ITCs aside: Line 106 is then the receipt-backed figure alone", () => {
  const rows = [scanned(10), calc(13)];
  const off = calculateHSTReturn(0, [], rows, { includeCalculated: false });
  assert.equal(off.line106, 10);
  assert.equal(off.line106Calculated, 13, "the calculated part is still reported, just not counted");
  assert.equal(calculateHSTReturn(0, [], rows, { includeCalculated: true }).line106, 23);
  // Line 109 follows Line 106.
  assert.equal(off.line109, -10);
});

test("a calculated Meals ITC is claimed at its own 50%; the stored tax is the full 13%", () => {
  const meals = calc(65, { tax_category: "Meals", itc_pct: 0.5, deductible_pct: 0.5 });
  assert.equal(calculateHSTReturn(0, [], [meals]).line106, 32.5);
});

test("a no-tax code claims nothing even on a category that would claim 100%", () => {
  const fee = { ...calc(0), tax_rate: 0, itc_pct: 0, deductible_pct: 1 };
  assert.equal(calculateHSTReturn(0, [], [fee]).line106, 0);
});

test("a statement expense with no code counts as needing one, and contributes no ITC", () => {
  const lines = calculateHSTReturn(0, [], [scanned(10), none, calc(13)]);
  assert.equal(lines.needsTaxCodeCount, 1);
  assert.equal(lines.calculatedCount, 2);
  assert.equal(lines.line106, 23);
});

test("a manually typed expense or an attached receipt is CONFIRMED, never calculated", () => {
  const manual = { total_amount: 113, tax_amount: 13, tax_category: "Supplies", from_statement: false, no_receipt: false };
  const attachedRow = { total_amount: 113, tax_amount: 13, tax_category: "Supplies", from_statement: true, no_receipt: false };
  const lines = calculateHSTReturn(0, [], [manual, attachedRow]);
  assert.deepEqual([lines.line106Confirmed, lines.line106Calculated, lines.calculatedCount], [26, 0, 0]);
});

test("expense summary: the same split, and deductible spend reads each row's own deductible share", () => {
  const rows = [
    scanned(10),
    calc(13),
    { total_amount: 100, tax_amount: 0, tax_category: "Supplies", from_statement: true, no_receipt: true, tax_rate: 0, itc_pct: 0, deductible_pct: 1 },
    calc(65, { tax_category: "Meals", itc_pct: 0.5, deductible_pct: 0.5, total_amount: 565 }),
  ];
  const s = computeExpenseSummary(rows);
  assert.equal(s.estHstConfirmed, 10);
  assert.equal(s.estHstCalculated, 45.5);
  assert.equal(s.estHstReclaimable, 55.5);
  assert.equal(s.calculatedCount, 3);
  assert.equal(s.needsTaxCodeCount, 0);
  // a no-tax code is 0% claimable but 100% deductible - the two are separate numbers
  assert.equal(s.deductibleSpend, 582.6);
});

test("the one-line note: absent without statement expenses, otherwise confirmed / calculated / needs a code", () => {
  const money = (n: number) => `$${n.toFixed(2)}`;
  assert.equal(itcSplitNote(computeExpenseSummary([scanned(10)]), money), null);
  assert.equal(
    itcSplitNote(computeExpenseSummary([scanned(10), calc(13)]), money),
    "$10.00 confirmed · $13.00 calculated from statements",
  );
  assert.equal(
    itcSplitNote(computeExpenseSummary([scanned(10), calc(13), none]), money),
    "$10.00 confirmed · $13.00 calculated from statements · 1 needs a tax code",
  );
  assert.match(itcSplitNote(computeExpenseSummary([calc(13), none, { ...none }]), money)!, /2 need a tax code/);
});

test("CSV export: every row says whether its tax is calculated from a statement or confirmed", () => {
  const base = { merchant_name: "X", transaction_date: "2026-03-14", items: [], paid_with_account_id: null };
  const csv = receiptsToCsv([
    { ...base, total_amount: 113, tax_amount: 13, tax_category: "Supplies" },
    { ...base, total_amount: 113, tax_amount: 13, tax_category: "Supplies", from_statement: true, no_receipt: true, tax_rate: 0.13 },
  ] as unknown as Receipt[]).split("\n");
  assert.equal(csv[0].split(",").at(-1), "Tax Basis");
  assert.equal(csv[1].split(",").at(-1), "Confirmed by receipt");
  assert.equal(csv[2].split(",").at(-1), "Calculated from statement");
  assert.equal(csv.at(-1)!.split(",").length, csv[0].split(",").length, "the totals row keeps the same column count");
});
