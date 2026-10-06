import assert from "node:assert/strict";
import test from "node:test";
import { statementExpenseFlag } from "./statement-flags.ts";

test("a statement-created expense without a receipt is flagged", () => {
  assert.equal(
    statementExpenseFlag({ no_receipt: true, total_amount: 48.2, tax_amount: 0 })?.label,
    "No receipt, ITC not claimed",
  );
});

test("a normal receipt, or one with a scan attached, has no flag", () => {
  assert.equal(statementExpenseFlag({ no_receipt: false, total_amount: 48.2, tax_amount: 6.27 }), null);
  assert.equal(statementExpenseFlag({ total_amount: 48.2, tax_amount: 6.27 }), null);
});

test("a refund says its HST hasn't been adjusted until a figure is entered", () => {
  assert.equal(
    statementExpenseFlag({ no_receipt: true, total_amount: -12.5, tax_amount: 0 })?.label,
    "Refund, no receipt, HST not adjusted",
  );
  assert.equal(
    statementExpenseFlag({ no_receipt: true, total_amount: -12.5, tax_amount: -1.63 })?.label,
    "Refund, no receipt",
  );
});
