import { test } from "node:test";
import assert from "node:assert/strict";
import { buildJobCostSummaries, calculateJobRevenue } from "./job-revenue.ts";

const invoice = (over = {}) => ({
  type: "invoice" as const,
  subtotal: 1000,
  total_amount: 1130,
  payments: [{ amount: 565 }],
  ...over,
});

test("Job Costing ignores excluded_from_hst by default", () => {
  assert.equal(calculateJobRevenue([invoice({ excluded_from_hst: true })]), 500);
});

test("honorExcludedFromHst drops an excluded invoice, like the P&L revenue rule", () => {
  const docs = [invoice({ excluded_from_hst: true }), invoice()];
  assert.equal(calculateJobRevenue(docs, { honorExcludedFromHst: true }), 500);
  assert.equal(calculateJobRevenue(docs), 1000);
});

test("buildJobCostSummaries passes the option through to revenue and profit", () => {
  const docs = [{ job_id: "j1", ...invoice({ excluded_from_hst: true }) }];
  const normal = buildJobCostSummaries(["j1"], [], [], docs).get("j1")!;
  const honoring = buildJobCostSummaries(["j1"], [], [], docs, { honorExcludedFromHst: true }).get("j1")!;
  assert.equal(normal.jobRevenue, 500);
  assert.equal(honoring.jobRevenue, 0);
  assert.equal(honoring.estProfit, 0);
  // The invoice is still linked to the job either way.
  assert.equal(honoring.linkedInvoiceCount, 1);
});
