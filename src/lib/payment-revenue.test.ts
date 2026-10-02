import { test } from "node:test";
import assert from "node:assert/strict";
import { recognizePayments } from "./payment-revenue.ts";

const doc = (over = {}) => ({
  subtotal: 1000,
  total_amount: 1130,
  excluded_from_hst: false,
  payments: [
    { amount: 565, paid_date: "2026-09-10" },
    { amount: 565, paid_date: "2026-10-05" },
  ],
  ...over,
});

test("a deposit counts pre-tax in the period it was received, not the invoice's", () => {
  const r = recognizePayments([doc()], "2026-09-01", "2026-09-30");
  assert.equal(r.totalSales, 500);
  assert.equal(r.hstCollected, 65);
  assert.equal(r.payments.length, 1);
});

test("an invoice excluded from HST is excluded from revenue too", () => {
  const r = recognizePayments([doc({ excluded_from_hst: true })], null, null);
  assert.equal(r.totalSales, 0);
});

test("bounds are inclusive and null means unbounded", () => {
  assert.equal(recognizePayments([doc()], "2026-09-10", "2026-10-05").totalSales, 1000);
  assert.equal(recognizePayments([doc()], null, null).totalSales, 1000);
});
