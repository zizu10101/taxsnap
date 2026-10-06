import assert from "node:assert/strict";
import test from "node:test";
import { browseExpenses, type BrowseRow } from "./statement-browse.ts";
import { STATEMENT_BROWSE_LIMIT } from "./statement-config.ts";

// 250 statement expenses still waiting for a receipt: far more than one screenful.
const VENDORS = ["Rogers", "Shell", "Home Depot", "Telus", "Staples", "Canadian Tire"];

function iso(dayOffset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + dayOffset * 86_400_000).toISOString().slice(0, 10);
}

function many(n = 250): BrowseRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `exp-${String(i).padStart(4, "0")}`,
    date: iso(i % 300),
    amount: 10 + (i % 97) + (i % 7) / 10,
    merchant_name: VENDORS[i % VENDORS.length] + (i >= 240 ? ` #${i}` : ""),
    tax_category: "Other",
  }));
}

const scan = { date: "2026-06-15", total: 89.99, merchant: "Rogers Communications Canada Inc." };

test("with 250 waiting expenses a page is capped at 100, and the rest are reachable", () => {
  const rows = many(250);
  const p1 = browseExpenses(rows, scan);
  assert.equal(STATEMENT_BROWSE_LIMIT, 100);
  assert.equal(p1.items.length, 100);
  assert.equal(p1.total, 250);
  assert.equal(p1.hasMore, true);

  const p2 = browseExpenses(rows, scan, { offset: 100 });
  const p3 = browseExpenses(rows, scan, { offset: 200 });
  assert.equal(p2.items.length, 100);
  assert.equal(p2.hasMore, true);
  assert.equal(p3.items.length, 50);
  assert.equal(p3.hasMore, false);
});

test("paging neither repeats nor skips an expense", () => {
  const rows = many(250);
  const seen = [100, 100, 50].flatMap((_, i) => browseExpenses(rows, scan, { offset: i * 100 }).items.map((r) => r.id));
  assert.equal(seen.length, 250);
  assert.equal(new Set(seen).size, 250);
  assert.deepEqual([...seen].sort(), rows.map((r) => r.id).sort());
});

test("a caller can't ask for more than a screenful", () => {
  const page = browseExpenses(many(250), scan, { limit: 5000 });
  assert.equal(page.items.length, 100);
  assert.equal(browseExpenses(many(250), scan, { limit: 10 }).items.length, 10);
  assert.equal(browseExpenses(many(250), scan, { limit: 0 }).items.length, 1, "a nonsense limit still returns something");
});

test("an offset past the end is an empty last page, not an error", () => {
  const p = browseExpenses(many(250), scan, { offset: 900 });
  assert.deepEqual([p.items.length, p.hasMore, p.total], [0, false, 250]);
});

test("search finds an expense that is nowhere near the first 100", () => {
  const rows = many(250);
  const needle = rows[245]; // "Telus #245"-style, sorted far from the scan date
  const unfiltered = browseExpenses(rows, scan).items.map((r) => r.id);
  assert.ok(!unfiltered.includes(needle.id), "precondition: not on the first page");

  const found = browseExpenses(rows, scan, { q: "#245" });
  assert.deepEqual(found.items.map((r) => r.id), [needle.id]);
  assert.equal(found.total, 1);
  assert.equal(found.hasMore, false);
});

test("search matches the merchant, the amount and the date, case-insensitively", () => {
  const rows: BrowseRow[] = [
    { id: "a", date: "2026-02-22", amount: 89.99, merchant_name: "Rogers", tax_category: "Phone" },
    { id: "b", date: "2026-03-01", amount: 12.5, merchant_name: "Staples", tax_category: "Office/Admin" },
  ];
  assert.deepEqual(browseExpenses(rows, scan, { q: "ROGERS" }).items.map((r) => r.id), ["a"]);
  assert.deepEqual(browseExpenses(rows, scan, { q: "89.99" }).items.map((r) => r.id), ["a"]);
  assert.deepEqual(browseExpenses(rows, scan, { q: "$12.50" }).items.map((r) => r.id), ["b"]);
  assert.deepEqual(browseExpenses(rows, scan, { q: "2026-03" }).items.map((r) => r.id), ["b"]);
  assert.deepEqual(browseExpenses(rows, scan, { q: "office" }).items.map((r) => r.id), ["b"]);
  assert.equal(browseExpenses(rows, scan, { q: "zzz" }).total, 0);
});

test("the matcher's own candidates come first even when they would be buried by date alone", () => {
  const rows = many(250);
  // A same-vendor, same-amount bill 25 days from the scan: a vendor-tier candidate...
  rows.push({ id: "the-bill", date: iso(166 + 25), amount: 89.99, merchant_name: "Rogers", tax_category: "Phone" });
  // ...and 100 unrelated expenses dated within a day of the scan.
  const near = Array.from({ length: 100 }, (_, i) => ({
    id: `near-${i}`, date: "2026-06-15", amount: 5 + i, merchant_name: "Other " + i, tax_category: "Other",
  }));
  const page = browseExpenses([...rows, ...near], scan);
  assert.equal(page.items[0].id, "the-bill");
  assert.equal(page.items[0].kind, "vendor");
  assert.equal(page.items[0].amount_matches, true);
});

test("without a scan total there are no candidates: the list is ordered by how close the dates are", () => {
  const rows: BrowseRow[] = [
    { id: "far", date: "2026-01-01", amount: 10, merchant_name: "A", tax_category: "Other" },
    { id: "near", date: "2026-06-14", amount: 20, merchant_name: "B", tax_category: "Other" },
    { id: "mid", date: "2026-05-01", amount: 30, merchant_name: "C", tax_category: "Other" },
  ];
  const page = browseExpenses(rows, { date: "2026-06-15", total: null, merchant: null });
  assert.deepEqual(page.items.map((r) => r.id), ["near", "mid", "far"]);
  assert.ok(page.items.every((r) => r.kind === null));
});

test("an empty list is a valid, empty page", () => {
  assert.deepEqual(browseExpenses([], scan), { items: [], total: 0, hasMore: false, offset: 0 });
});
