import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildVendorReport, NO_VENDOR_NAME } from "./vendor-report.ts";
import { buildRevenueReport, NO_CLIENT_NAME, NO_JOB_NAME } from "./revenue-report.ts";
import { recognizePayments } from "./payment-revenue.ts";
import { revenueReportToCsv, vendorReportToCsv } from "./csv.ts";

// ------------------------------------------------------------ vendors

let n = 0;
const expense = (merchant: string, total: number, tax: number, over = {}) => ({
  id: `r${++n}`,
  merchant_name: merchant,
  transaction_date: "2026-09-10",
  tax_category: "Supplies",
  total_amount: total,
  tax_amount: tax,
  ...over,
});

test("vendors: store numbers, case and statement spellings are one vendor", () => {
  const report = buildVendorReport([
    expense("HOME DEPOT #4521", 113, 13),
    expense("Home Depot", 226, 26),
    expense("Home Depot #77", 56.5, 6.5),
    expense("Shell", 50, 0),
  ]);
  assert.equal(report.vendors.length, 2);
  const hd = report.vendors[0];
  assert.equal(hd.name, "Home Depot");
  assert.equal(hd.count, 3);
  assert.equal(hd.subtotal, 350);
  assert.equal(hd.tax, 45.5);
  assert.equal(hd.total, 395.5);
});

test("vendors: Shell and Shell Energy stay separate (same normalizer as the matcher)", () => {
  const report = buildVendorReport([expense("Shell", 10, 0), expense("Shell Energy", 20, 0)]);
  assert.equal(report.vendors.length, 2);
});

test("vendors: sorted by total, share adds to 100%, total row ties out", () => {
  const report = buildVendorReport([
    expense("A", 25, 0),
    expense("B", 75, 0),
    expense("C", 100, 0),
  ]);
  assert.deepEqual(report.vendors.map((v) => v.name), ["C", "B", "A"]);
  assert.deepEqual(report.vendors.map((v) => v.share), [0.5, 0.375, 0.125]);
  assert.equal(report.totals.total, 200);
  assert.equal(report.totals.count, 3);
  assert.equal(report.vendors.reduce((s, v) => s + v.total, 0), report.totals.total);
});

test("vendors: refunds net off, an empty name gets its own bucket, an empty report is zeros", () => {
  const report = buildVendorReport([expense("Rona", 100, 0), expense("Rona", -40, 0), expense("  ", 5, 0)]);
  const rona = report.vendors.find((v) => v.name === "Rona")!;
  assert.equal(rona.total, 60);
  assert.ok(report.vendors.some((v) => v.name === NO_VENDOR_NAME));
  const empty = buildVendorReport([]);
  assert.deepEqual(empty.totals, { count: 0, subtotal: 0, tax: 0, total: 0 });
});

test("vendors: category filter narrows the rows but keeps every category on offer", () => {
  const rows = [
    expense("Rona", 100, 0, { tax_category: "Supplies" }),
    expense("Rona", 40, 0, { tax_category: "Fuel" }),
    expense("Esso", 60, 0, { tax_category: "Fuel" }),
  ];
  const fuel = buildVendorReport(rows, "fuel");
  assert.equal(fuel.totals.total, 100);
  assert.deepEqual(fuel.vendors.map((v) => v.name), ["Esso", "Rona"]);
  assert.deepEqual(fuel.categories, ["Fuel", "Supplies"]);
  assert.equal(fuel.vendors.find((v) => v.name === "Rona")!.share, 0.4);
});

test("vendors: drill-down expenses are exactly the ones counted", () => {
  const report = buildVendorReport([expense("Rona", 10, 1), expense("rona", 20, 2)]);
  assert.equal(report.vendors[0].expenses.length, report.vendors[0].count);
});

// ------------------------------------------------------------ revenue

let d = 0;
const invoice = (over = {}) => ({
  id: `d${++d}`,
  document_number: d,
  status: "sent",
  issue_date: "2026-09-05",
  subtotal: 1000,
  total_amount: 1130,
  excluded_from_hst: false,
  client_id: "c1",
  job_id: "j1",
  client: { name: "Acme" },
  job: { name: "Kitchen" },
  payments: [] as { id: string; amount: number; paid_date: string }[],
  ...over,
});

test("revenue: a partly paid invoice counts only what was received, before HST", () => {
  const report = buildRevenueReport(
    [invoice({ payments: [{ id: "p1", amount: 565, paid_date: "2026-09-10" }] })],
    "2026-09-01",
    "2026-09-30",
  );
  assert.deepEqual(report.summary, { received: 500, invoiced: 1000, outstanding: 500 });
});

test("revenue: a payment outside the period is not revenue, but its invoice is still invoiced", () => {
  const report = buildRevenueReport(
    [
      invoice({
        payments: [
          { id: "p1", amount: 565, paid_date: "2026-09-10" },
          { id: "p2", amount: 565, paid_date: "2026-10-05" },
        ],
      }),
    ],
    "2026-09-01",
    "2026-09-30",
  );
  assert.equal(report.summary.received, 500);
  assert.equal(report.byClient[0].payments.length, 1);
});

test("revenue: a payment on an older invoice counts when it is received, with nothing invoiced", () => {
  const report = buildRevenueReport(
    [invoice({ issue_date: "2026-07-01", payments: [{ id: "p1", amount: 1130, paid_date: "2026-09-15" }] })],
    "2026-09-01",
    "2026-09-30",
  );
  assert.deepEqual(report.summary, { received: 1000, invoiced: 0, outstanding: -1000 });
});

test("revenue: a deleted payment is gone from revenue even when the invoice still says paid", () => {
  const withPayment = invoice({ status: "paid", payments: [{ id: "p1", amount: 1130, paid_date: "2026-09-10" }] });
  const afterDelete = { ...withPayment, payments: [] };
  assert.equal(buildRevenueReport([withPayment], "2026-09-01", "2026-09-30").summary.received, 1000);
  assert.equal(buildRevenueReport([afterDelete], "2026-09-01", "2026-09-30").summary.received, 0);
});

test("revenue: invoice totals are never revenue (unpaid invoice = 0 received)", () => {
  const report = buildRevenueReport([invoice()], "2026-09-01", "2026-09-30");
  assert.equal(report.summary.received, 0);
  assert.equal(report.summary.invoiced, 1000);
});

test("revenue: received equals the P&L rule (recognizePayments), excluded invoices and drafts handled", () => {
  const docs = [
    invoice({ payments: [{ id: "a", amount: 565, paid_date: "2026-09-10" }] }),
    invoice({ excluded_from_hst: true, payments: [{ id: "b", amount: 113, paid_date: "2026-09-11" }] }),
    invoice({ status: "draft", subtotal: 400, total_amount: 452 }),
  ];
  const report = buildRevenueReport(docs, "2026-09-01", "2026-09-30");
  assert.equal(report.summary.received, recognizePayments(docs, "2026-09-01", "2026-09-30").totalSales);
  // excluded invoice and the draft are not invoiced
  assert.equal(report.summary.invoiced, 1000);
});

test("revenue: No client / No job buckets, and the groups add up to the summary", () => {
  const docs = [
    invoice({ payments: [{ id: "a", amount: 565, paid_date: "2026-09-10" }] }),
    invoice({ client_id: null, client: null, job_id: null, job: null, subtotal: 200, total_amount: 226,
      payments: [{ id: "b", amount: 113, paid_date: "2026-09-12" }] }),
  ];
  const report = buildRevenueReport(docs, "2026-09-01", "2026-09-30");
  for (const groups of [report.byClient, report.byJob]) {
    assert.equal(groups.reduce((s, g) => s + g.received, 0), report.summary.received);
    assert.equal(groups.reduce((s, g) => s + g.invoiced, 0), report.summary.invoiced);
    assert.equal(groups.reduce((s, g) => s + g.outstanding, 0), report.summary.outstanding);
  }
  assert.ok(report.byClient.some((g) => g.id === null && g.name === NO_CLIENT_NAME));
  assert.ok(report.byJob.some((g) => g.id === null && g.name === NO_JOB_NAME));
  const acme = report.byClient.find((g) => g.name === "Acme")!;
  assert.equal(acme.invoices, 1);
  assert.equal(acme.payments.length, 1);
  assert.equal(acme.documents.length, 1);
});

test("revenue: by month splits invoiced by issue month and received by payment month", () => {
  const report = buildRevenueReport(
    [
      invoice({
        issue_date: "2026-08-20",
        payments: [
          { id: "a", amount: 565, paid_date: "2026-08-25" },
          { id: "b", amount: 565, paid_date: "2026-09-02" },
        ],
      }),
    ],
    "2026-08-01",
    "2026-09-30",
  );
  assert.deepEqual(report.byMonth, [
    { month: "2026-08", invoiced: 1000, received: 500, outstanding: 500 },
    { month: "2026-09", invoiced: 0, received: 500, outstanding: -500 },
  ]);
});

// ------------------------------------------------------------ csv + source guards

test("csv: vendor and revenue exports carry a total / summary row", () => {
  const vendorCsv = vendorReportToCsv(buildVendorReport([expense("Rona", 113, 13)]));
  assert.match(vendorCsv, /^Vendor,Expenses,Subtotal,Tax \(HST\),Total,Share of Total \(%\)\n/);
  assert.match(vendorCsv, /\nTOTAL,1,100\.00,13\.00,113\.00,100\.0$/);
  const revenueCsv = revenueReportToCsv(
    buildRevenueReport([invoice({ payments: [{ id: "a", amount: 565, paid_date: "2026-09-10" }] })], null, null),
  );
  assert.match(revenueCsv, /\nSummary,All,,1000\.00,500\.00,500\.00\n/);
  assert.match(revenueCsv, /\nClient,Acme,1,/);
});

test("queries: both new reports scope by user_id and never read owner notes or line items", () => {
  const src = readFileSync(new URL("./reports-query.ts", import.meta.url), "utf8");
  for (const fn of ["getVendorReport", "getRevenueReport"]) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const end = body.indexOf("\n}\n");
    const text = body.slice(0, end);
    assert.match(text, /\.eq\("user_id", userId\)/, `${fn} filters on user_id`);
    assert.doesNotMatch(text, /notes|document_items|select\("\*"\)/, `${fn} selects only report columns`);
  }
});
