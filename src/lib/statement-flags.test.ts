import assert from "node:assert/strict";
import test from "node:test";
import { statementExpenseFlag } from "./statement-flags.ts";

test("a statement expense with no receipt and NO tax code says it needs one (nothing was calculated)", () => {
  const flag = statementExpenseFlag({ no_receipt: true, total_amount: 48.2, tax_amount: 0 });
  assert.equal(flag?.label, "No receipt, needs a tax code");
  assert.equal(flag?.tone, "needs_code");
});

test("a statement expense with a tax code says its tax is calculated, not read from a receipt", () => {
  const flag = statementExpenseFlag({ no_receipt: true, total_amount: 113, tax_amount: 13, tax_rate: 0.13 });
  assert.equal(flag?.label, "Tax calculated from statement");
  assert.equal(flag?.tone, "calculated");
  // A no-tax code is still a code: calculated as 0, not "needs a code".
  assert.equal(statementExpenseFlag({ no_receipt: true, total_amount: 20, tax_amount: 0, tax_rate: 0 })?.label, "Tax calculated from statement");
});

test("a normal receipt, or one with a scan attached, has no flag", () => {
  assert.equal(statementExpenseFlag({ no_receipt: false, total_amount: 48.2, tax_amount: 6.27 }), null);
  assert.equal(statementExpenseFlag({ total_amount: 48.2, tax_amount: 6.27 }), null);
  assert.equal(statementExpenseFlag({ no_receipt: false, total_amount: 48.2, tax_amount: 0, tax_rate: 0.13 }), null);
});

test("a refund: needs a code until one applies, then its tax is calculated (reversing the ITC)", () => {
  assert.equal(
    statementExpenseFlag({ no_receipt: true, total_amount: -12.5, tax_amount: 0 })?.label,
    "Refund, no receipt, needs a tax code",
  );
  assert.equal(
    statementExpenseFlag({ no_receipt: true, total_amount: -113, tax_amount: -13, tax_rate: 0.13 })?.label,
    "Refund, tax calculated from statement",
  );
});

test("a refund whose HST the owner typed from the slip is not 'needs a code'", () => {
  const flag = statementExpenseFlag({ no_receipt: true, total_amount: -12.5, tax_amount: -1.63 });
  assert.equal(flag?.label, "Refund, no receipt");
  assert.equal(flag?.tone, "info");
});
