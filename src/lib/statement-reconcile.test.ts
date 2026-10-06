import assert from "node:assert/strict";
import test from "node:test";
import { reconcileStatement } from "./statement-reconcile.ts";

const base = { opening_balance: null, closing_balance: null, statement_total: null, statement_total_kind: null } as const;

test("balance roll matches when closing - opening equals the signed sum of every line", () => {
  const r = reconcileStatement({
    ...base,
    opening_balance: 1000,
    closing_balance: 860.8,
    lines: [
      { amount: 48.2, kind: "purchase" },
      { amount: 18.4, kind: "interest" },
      { amount: -12.5, kind: "refund" },
      { amount: -200.3, kind: "payment" },
      { amount: 7.0, kind: "purchase" },
    ],
  });
  assert.equal(r.status, "matches");
  assert.equal("basis" in r && r.basis, "balance_roll");
});

test("an off statement reports the gap as extracted minus expected", () => {
  const r = reconcileStatement({
    ...base,
    opening_balance: 100,
    closing_balance: 250,
    lines: [{ amount: 100, kind: "purchase" }],
  });
  assert.equal(r.status, "off");
  if (r.status === "off") {
    assert.equal(r.expected, 150);
    assert.equal(r.extracted, 100);
    assert.equal(r.diff, -50);
  }
});

test("float noise does not flag a correct statement", () => {
  const r = reconcileStatement({
    ...base,
    opening_balance: 0,
    closing_balance: 0.6,
    lines: [
      { amount: 0.1, kind: "purchase" },
      { amount: 0.2, kind: "purchase" },
      { amount: 0.3, kind: "purchase" },
    ],
  });
  assert.equal(r.status, "matches");
});

test("with only a purchases total, only purchase lines are summed", () => {
  const r = reconcileStatement({
    ...base,
    statement_total: 55.2,
    statement_total_kind: "purchases",
    lines: [
      { amount: 48.2, kind: "purchase" },
      { amount: 7, kind: "purchase" },
      { amount: 18.4, kind: "interest" },
      { amount: -200, kind: "payment" },
      { amount: -5, kind: "refund" },
    ],
  });
  assert.equal(r.status, "matches");
  assert.equal("basis" in r && r.basis, "purchases");
});

test("balance roll wins when both checks are possible", () => {
  const r = reconcileStatement({
    opening_balance: 0,
    closing_balance: 10,
    statement_total: 999,
    statement_total_kind: "purchases",
    lines: [{ amount: 10, kind: "purchase" }],
  });
  assert.equal(r.status, "matches");
});

test("a new-balance total alone is not enough to check anything", () => {
  assert.equal(
    reconcileStatement({ ...base, statement_total: 500, statement_total_kind: "new_balance", lines: [{ amount: 1, kind: "purchase" }] }).status,
    "no_total",
  );
  assert.equal(reconcileStatement({ ...base, lines: [] }).status, "no_total");
});

test("only one of opening/closing present falls through to no_total", () => {
  assert.equal(reconcileStatement({ ...base, opening_balance: 10, lines: [] }).status, "no_total");
});
