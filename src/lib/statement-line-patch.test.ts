import assert from "node:assert/strict";
import test from "node:test";
import { buildLineUpdate, type LinePatch, type LineState } from "./statement-line-patch.ts";

const TODAY = "2026-10-05";
const CATS = ["Supplies", "Meals", "Bank charges", "Other"];

function line(overrides: Partial<LineState> = {}): LineState {
  return {
    kind: "purchase",
    amount: 48.2,
    txn_date: "2026-09-10",
    resolution: null,
    suggested_category: "Supplies",
    duplicate_of_line_id: null,
    duplicate_override: false,
    tax_amount: 0,
    ...overrides,
  };
}
const run = (l: LineState, p: LinePatch) => buildLineUpdate(l, p, CATS, TODAY);
function ok(o: ReturnType<typeof run>) {
  assert.equal(o.ok, true, JSON.stringify(o));
  assert.ok(!("skip" in o), "unexpected skip");
  return o as Extract<ReturnType<typeof run>, { update: unknown }>;
}
const errorOf = (o: ReturnType<typeof run>) => (o.ok ? null : o.error);

test("choosing a category confirms it and includes the line as a new expense", () => {
  const o = ok(run(line(), { category: "supplies" }));
  assert.equal(o.update.category, "Supplies");
  assert.equal(o.update.category_confirmed, true);
  assert.equal(o.update.resolution, "new_expense");
});

test("accepting the suggestion does the same with the suggested category", () => {
  const o = ok(run(line(), { accept_suggestion: true }));
  assert.equal(o.update.category, "Supplies");
  assert.equal(o.update.category_confirmed, true);
  assert.equal(o.update.resolution, "new_expense");
});

test("accepting a suggestion that doesn't exist is skipped, not an error", () => {
  const o = run(line({ suggested_category: null }), { accept_suggestion: true });
  assert.equal(o.ok && "skip" in o, true);
});

test("a category outside the owner's list is refused", () => {
  assert.match(errorOf(run(line(), { category: "Yacht" }))!, /isn't one of yours/);
});

test("accepting a category on a line the user skipped does not silently un-skip it", () => {
  const o = ok(run(line({ resolution: "skipped" }), { category: "Meals" }));
  assert.equal(o.update.resolution, undefined);
});

test("a refund must be negative, including when the kind is changed to refund", () => {
  assert.match(errorOf(run(line(), { kind: "refund" }))!, /negative/);
  const o = ok(run(line(), { kind: "refund", amount: -12.5 }));
  assert.equal(o.update.kind, "refund");
  assert.equal(o.update.amount, -12.5);
  assert.equal(o.refingerprint, true);
});

test("HST can only be entered on a refund and is stored as a credit", () => {
  assert.match(errorOf(run(line(), { tax_amount: 1.63 }))!, /only be entered on a refund/);
  const refund = line({ kind: "refund", amount: -12.5 });
  assert.equal(ok(run(refund, { tax_amount: 1.63 })).update.tax_amount, -1.63);
  assert.equal(ok(run(refund, { tax_amount: 0 })).update.tax_amount, 0);
  assert.match(errorOf(run(refund, { tax_amount: 99 }))!, /more than the refund/);
});

test("changing a refund into something else drops its HST", () => {
  const refund = line({ kind: "refund", amount: -12.5, tax_amount: -1.63 });
  const o = ok(run(refund, { kind: "other", amount: 12.5 }));
  assert.equal(o.update.tax_amount, 0);
});

test("only a positive purchase can be matched, and a receipt must be named", () => {
  assert.match(errorOf(run(line({ kind: "interest" }), { resolution: "matched", matched_receipt_id: "r" }))!, /purchase/);
  assert.match(errorOf(run(line({ kind: "refund", amount: -5 }), { matched_receipt_id: "r" }))!, /purchase/);
  assert.match(errorOf(run(line(), { resolution: "matched" }))!, /Choose which receipt/);
  const o = ok(run(line(), { matched_receipt_id: "11111111-1111-1111-1111-111111111111" }));
  assert.equal(o.update.resolution, "matched");
  assert.equal(o.checkReceiptId, "11111111-1111-1111-1111-111111111111");
});

test("leaving 'matched' releases the receipt claim", () => {
  const o = ok(run(line({ resolution: "matched" }), { resolution: "new_expense", category: "Supplies" }));
  assert.equal(o.update.matched_receipt_id, null);
  assert.equal(o.update.resolution, "new_expense");
});

test("a payment can't be made an expense; changing its type first is allowed", () => {
  assert.match(errorOf(run(line({ kind: "payment", amount: -50 }), { resolution: "new_expense" }))!, /isn't an expense/);
  const o = ok(run(line({ kind: "payment", amount: -50, resolution: "skipped" }), { kind: "refund" }));
  assert.equal(o.update.kind, "refund");
});

test("turning a line into a payment skips it", () => {
  assert.equal(ok(run(line({ resolution: "new_expense" }), { kind: "payment", amount: -48.2 })).update.resolution, "skipped");
});

test("Import anyway is only valid on a flagged duplicate, and asks the user to choose", () => {
  assert.match(errorOf(run(line(), { duplicate_override: true }))!, /isn't a duplicate/);
  const dup = line({ duplicate_of_line_id: "x", resolution: "skipped" });
  const o = ok(run(dup, { duplicate_override: true }));
  assert.equal(o.update.duplicate_override, true);
  assert.equal(o.update.resolution, null);
});

test("Import anyway with an explicit choice applies it", () => {
  const dup = line({ duplicate_of_line_id: "x", resolution: "skipped" });
  const o = ok(run(dup, { duplicate_override: true, resolution: "new_expense", category: "Meals" }));
  assert.equal(o.update.resolution, "new_expense");
});

test("undoing the override puts the duplicate back to skipped", () => {
  const dup = line({ duplicate_of_line_id: "x", duplicate_override: true, resolution: "new_expense" });
  const o = ok(run(dup, { duplicate_override: false }));
  assert.equal(o.update.resolution, "skipped");
});

test("date and amount edits are validated and trigger a re-fingerprint", () => {
  assert.match(errorOf(run(line(), { txn_date: "2026-13-01" }))!, /valid date/);
  assert.match(errorOf(run(line(), { txn_date: "2027-01-01" }))!, /future/);
  assert.match(errorOf(run(line(), { amount: 0 }))!, /other than 0/);
  const o = ok(run(line(), { txn_date: "2026-09-11", amount: 50 }));
  assert.equal(o.refingerprint, true);
  assert.equal(ok(run(line(), { description: "x" })).refingerprint, false);
});

test("descriptions are cleaned and card numbers masked", () => {
  const o = ok(run(line(), { description: "  XFER   4520123456789012 " }));
  assert.equal(o.update.description, "XFER ****9012");
  assert.match(errorOf(run(line(), { description: "   " }))!, /description/);
});

test("paid-with is passed through for the caller to verify", () => {
  const o = ok(run(line(), { paid_with_account_id: "acct" }));
  assert.equal(o.checkAccountId, "acct");
  assert.equal(ok(run(line(), { paid_with_account_id: null })).update.paid_with_account_id, null);
});
