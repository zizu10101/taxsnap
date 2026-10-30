import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildExpensesReport, NO_VENDOR_NAME } from "./expenses-report.ts";
import { buildRevenueReport, NO_CLIENT_NAME, NO_JOB_NAME } from "./revenue-report.ts";
import { recognizePayments } from "./payment-revenue.ts";
import { expensesByCategoryToCsv, expensesByVendorToCsv, revenueReportToCsv } from "./csv.ts";

// ------------------------------------------------------------ expenses: vendor mode

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
  const report = buildExpensesReport([
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
  assert.deepEqual(report.vendorOptions.map((o) => o.name), ["Home Depot", "Shell"]);
});

test("vendors: Shell and Shell Energy stay separate (same normalizer as the matcher)", () => {
  const report = buildExpensesReport([expense("Shell", 10, 0), expense("Shell Energy", 20, 0)]);
  assert.equal(report.vendors.length, 2);
});

test("vendors: sorted by total, share adds to 100%, total row ties out", () => {
  const report = buildExpensesReport([expense("A", 25, 0), expense("B", 75, 0), expense("C", 100, 0)]);
  assert.deepEqual(report.vendors.map((v) => v.name), ["C", "B", "A"]);
  assert.deepEqual(report.vendors.map((v) => v.share), [0.5, 0.375, 0.125]);
  assert.equal(report.totals.total, 200);
  assert.equal(report.totals.count, 3);
  assert.equal(report.vendors.reduce((s, v) => s + v.total, 0), report.totals.total);
});

test("vendors: refunds net off, an empty name gets its own bucket, an empty report is zeros", () => {
  const report = buildExpensesReport([expense("Rona", 100, 0), expense("Rona", -40, 0), expense("  ", 5, 0)]);
  assert.equal(report.vendors.find((v) => v.name === "Rona")!.total, 60);
  assert.ok(report.vendors.some((v) => v.name === NO_VENDOR_NAME));
  const empty = buildExpensesReport([]);
  assert.deepEqual(empty.totals, { count: 0, subtotal: 0, tax: 0, total: 0 });
});

test("vendors: drill-down expenses are exactly the ones counted", () => {
  const report = buildExpensesReport([expense("Rona", 10, 1), expense("rona", 20, 2)]);
  assert.equal(report.vendors[0].expenses.length, report.vendors[0].count);
});

// ------------------------------------------------------------ expenses: category mode

test("categories: canonical spelling, custom marker, sorted by total, before-HST and total paid", () => {
  const report = buildExpensesReport(
    [
      expense("A", 113, 13, { tax_category: "meals" }),
      expense("B", 50, 0, { tax_category: "Meals & Entertainment" }),
      expense("C", 500, 0, { tax_category: "Pet Care" }),
      expense("D", 10, 0, { tax_category: null }),
    ],
    {},
    ["Pet Care"],
  );
  assert.deepEqual(report.categories, [
    { category: "Pet Care", count: 1, preTax: 500, total: 500, isCustom: true },
    { category: "Meals & Entertainment", count: 2, preTax: 150, total: 163, isCustom: false },
    { category: "Other", count: 1, preTax: 10, total: 10, isCustom: false },
  ]);
  assert.equal(report.categories.reduce((s, c) => s + c.total, 0), report.totals.total);
});

// ------------------------------------------------------------ expenses: filters

const mixed = () => [
  expense("Home Depot #1", 100, 10, { tax_category: "Supplies" }),
  expense("HOME DEPOT", 40, 4, { tax_category: "Tools & Equipment" }),
  expense("Esso", 60, 6, { tax_category: "Vehicle/Fuel" }),
  expense("Rona", 25, 0, { tax_category: "Supplies" }),
];

test("filters: vendor and category together intersect, in both groupings", () => {
  const all = buildExpensesReport(mixed());
  const key = all.vendorOptions.find((o) => o.name === "Home Depot")!.key;
  const both = buildExpensesReport(mixed(), { vendor: key, category: "supplies" });
  assert.equal(both.totals.count, 1);
  assert.equal(both.totals.total, 100);
  assert.deepEqual(both.vendors.map((v) => v.name), ["Home Depot"]);
  assert.deepEqual(both.categories.map((c) => c.category), ["Materials & Supplies"]);
  // vendor alone spans two categories; category alone spans two vendors
  assert.equal(buildExpensesReport(mixed(), { vendor: key }).categories.length, 2);
  assert.equal(buildExpensesReport(mixed(), { category: "Supplies" }).vendors.length, 2);
});

test("filters: totals follow the filter in both modes and match the rows shown", () => {
  const key = buildExpensesReport(mixed()).vendorOptions.find((o) => o.name === "Home Depot")!.key;
  const r = buildExpensesReport(mixed(), { vendor: key });
  assert.deepEqual(r.totals, { count: 2, subtotal: 126, tax: 14, total: 140 });
  assert.equal(r.vendors.reduce((s, v) => s + v.total, 0), r.totals.total);
  assert.equal(r.categories.reduce((s, c) => s + c.total, 0), r.totals.total);
  assert.equal(r.categories.reduce((s, c) => s + c.preTax, 0), r.totals.subtotal);
  assert.equal(r.vendors[0].share, 1);
});

test("filters: the pickers still list the whole period, and a filter never renames a vendor", () => {
  const all = buildExpensesReport(mixed());
  const filtered = buildExpensesReport(mixed(), { category: "Vehicle/Fuel" });
  assert.deepEqual(filtered.vendorOptions, all.vendorOptions);
  assert.deepEqual(filtered.categoryOptions, all.categoryOptions);
  assert.deepEqual(filtered.vendors.map((v) => v.name), ["Esso"]);
});

test("filters: a combination with no rows is an empty report, not an error", () => {
  const key = buildExpensesReport(mixed()).vendorOptions.find((o) => o.name === "Esso")!.key;
  const r = buildExpensesReport(mixed(), { vendor: key, category: "Supplies" });
  assert.deepEqual(r.totals, { count: 0, subtotal: 0, tax: 0, total: 0 });
  assert.deepEqual(r.vendors, []);
  assert.deepEqual(r.categories, []);
});

test("csv: both groupings export what the filters leave, with a TOTAL row", () => {
  const key = buildExpensesReport(mixed()).vendorOptions.find((o) => o.name === "Home Depot")!.key;
  const r = buildExpensesReport(mixed(), { vendor: key });
  const byVendor = expensesByVendorToCsv(r);
  assert.match(byVendor, /^Vendor,Expenses,Subtotal,Tax \(HST\),Total,Share of Total \(%\)\n/);
  assert.match(byVendor, /\nHome Depot,2,126\.00,14\.00,140\.00,100\.0\n/);
  assert.match(byVendor, /\nTOTAL,2,126\.00,14\.00,140\.00,100\.0$/);
  assert.doesNotMatch(byVendor, /Esso|Rona/);
  const byCategory = expensesByCategoryToCsv(r);
  assert.match(byCategory, /^Category,Expenses,Before HST,Total Paid\n/);
  assert.match(byCategory, /\nMaterials & Supplies,1,90\.00,100\.00\n/);
  assert.match(byCategory, /\nTOTAL,2,126\.00,140\.00$/);
  assert.doesNotMatch(byCategory, /Vehicle & Fuel/);
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

test("csv: the revenue export carries a summary row and the groupings", () => {
  const revenueCsv = revenueReportToCsv(
    buildRevenueReport([invoice({ payments: [{ id: "a", amount: 565, paid_date: "2026-09-10" }] })], null, null),
  );
  assert.match(revenueCsv, /\nSummary,All,,1000\.00,500\.00,500\.00\n/);
  assert.match(revenueCsv, /\nClient,Acme,1,/);
});

test("queries: both new reports scope by user_id and never read owner notes or line items", () => {
  const src = readFileSync(new URL("./reports-query.ts", import.meta.url), "utf8");
  for (const fn of ["getExpensesReport", "getRevenueReport"]) {
    const body = src.slice(src.indexOf(`export async function ${fn}`));
    const end = body.indexOf("\n}\n");
    const text = body.slice(0, end);
    assert.match(text, /\.eq\("user_id", userId\)/, `${fn} filters on user_id`);
    assert.doesNotMatch(text, /notes|document_items|select\("\*"\)/, `${fn} selects only report columns`);
  }
});

test("the separate By Vendor tab, its routes and helpers are gone", () => {
  const here = fileURLToPath(import.meta.url);
  const leftovers = ["By " + "Vendor", "Vendors" + "Tab", "reports/" + "vendors", "vendor" + "-report", "get" + "VendorReport", "build" + "VendorReport", "vendor" + "ReportToCsv"];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const offenders = walk(fileURLToPath(new URL("..", import.meta.url)))
    .filter((f) => /\.(ts|tsx)$/.test(f) && f !== here)
    .filter((f) => {
      const text = readFileSync(f, "utf8");
      return leftovers.some((l) => text.includes(l));
    });
  assert.deepEqual(offenders, []);
  assert.ok(!existsSync(fileURLToPath(new URL("../app/api/reports/" + "vendors", import.meta.url))));
  assert.ok(!existsSync(fileURLToPath(new URL("../app/api/accountant-portal/reports/" + "vendors", import.meta.url))));
});

test("the Expenses report is wired to its own route and the shared date range, owner and accountant", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
  assert.match(read("../app/api/reports/expenses/route.ts"), /getExpensesReport/);
  assert.match(read("../app/api/accountant-portal/reports/expenses/route.ts"), /getAccountantApiContext/);
  const view = read("../components/reports/reports-view.tsx");
  assert.match(view, /<ExpensesTab range=\{range\}/);
  assert.match(view, /\{ key: "expenses", label: "Expenses" \}/);
});

test("categories: old and new names of one category are ONE row (Gas + Vehicle/Fuel + 407 + Vehicle & Fuel), and a custom 'Bank charges' joins the built-in", () => {
  const report = buildExpensesReport(
    [
      expense("a", 10, 0, { tax_category: "Gas" }),
      expense("b", 20, 0, { tax_category: "Vehicle/Fuel" }),
      expense("c", 30, 0, { tax_category: "407" }),
      expense("d", 40, 0, { tax_category: "Vehicle & Fuel" }),
      expense("e", 5, 0, { tax_category: "Bank charges" }),
      expense("f", 7, 0, { tax_category: "Bank Charges & Interest" }),
    ],
    {},
    ["Bank charges"],
  );
  assert.deepEqual(
    report.categories.map((c) => [c.category, c.count, c.total, c.isCustom]),
    [
      ["Vehicle & Fuel", 4, 100, false],
      ["Bank Charges & Interest", 2, 12, false],
    ],
  );
  // filtering by an old name finds the same rows, and the other way round
  assert.equal(buildExpensesReport([expense("a", 10, 0, { tax_category: "Gas" })], { category: "Vehicle & Fuel" }).totals.count, 1);
  assert.equal(buildExpensesReport([expense("a", 10, 0, { tax_category: "Vehicle & Fuel" })], { category: "gas" }).totals.count, 1);
});
