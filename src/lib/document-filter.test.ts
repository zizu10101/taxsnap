import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  countInvoicesThisMonth,
  drawBadgeLabel,
  filterByInvoiceType,
  isProgressDraw,
} from "./document-filter.ts";

const docs = [
  { id: "a", type: "invoice", created_at: "2026-10-02T10:00:00Z", is_progress_draw: false, draw_number: null },
  { id: "b", type: "invoice", created_at: "2026-10-03T10:00:00Z", is_progress_draw: true, draw_number: 1 },
  { id: "c", type: "invoice", created_at: "2026-10-04T10:00:00Z", is_progress_draw: true, draw_number: 2 },
  { id: "d", type: "invoice", created_at: "2026-09-20T10:00:00Z", is_progress_draw: true, draw_number: 3 },
  { id: "e", type: "estimate", created_at: "2026-10-05T10:00:00Z", is_progress_draw: false, draw_number: null },
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
const MONTH_START = "2026-10-01T00:00:00Z";

test("All shows everything, Standard hides draws, Progress shows only draws", () => {
  assert.deepEqual(ids(filterByInvoiceType(docs, "all")), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(ids(filterByInvoiceType(docs, "standard")), ["a", "e"]);
  assert.deepEqual(ids(filterByInvoiceType(docs, "progress")), ["b", "c", "d"]);
});

test("badge: 'Draw N' for a numbered draw, 'Progress' for an unnumbered one, none for a normal invoice", () => {
  assert.equal(drawBadgeLabel(docs[1]), "Draw 1");
  assert.equal(drawBadgeLabel({ is_progress_draw: true, draw_number: null }), "Progress");
  assert.equal(drawBadgeLabel(docs[0]), null);
  assert.equal(isProgressDraw({ is_progress_draw: null }), false);
});

test("the monthly invoice count counts each invoice once, draws included, estimates never", () => {
  // a, b, c are this month's invoices; d is last month's; e is an estimate.
  assert.equal(countInvoicesThisMonth(docs, MONTH_START), 3);
});

test("the count comes from the full list: a filtered subset would give a different number", () => {
  const all = countInvoicesThisMonth(docs, MONTH_START);
  assert.notEqual(countInvoicesThisMonth(filterByInvoiceType(docs, "standard"), MONTH_START), all);
  assert.notEqual(countInvoicesThisMonth(filterByInvoiceType(docs, "progress"), MONTH_START), all);
  const src = readFileSync(new URL("../components/invoices/document-list.tsx", import.meta.url), "utf8");
  assert.match(src, /countInvoicesThisMonth\(documents, from\)/);
});

test("a row that somehow appears twice in the input is still counted once", () => {
  assert.equal(countInvoicesThisMonth([docs[1], docs[1]], MONTH_START), 1);
});

test("with no start date every invoice counts", () => {
  assert.equal(countInvoicesThisMonth(docs, null), 4);
});

test("the server cap and the Invoices page both use every type='invoice' row, draws included", () => {
  const cap = readFileSync(new URL("./plan-limits.ts", import.meta.url), "utf8");
  const from = cap.indexOf('resource === "invoices"');
  const capQuery = cap.slice(from, from + 400);
  assert.match(capQuery, /\.eq\("type", "invoice"\)/);
  assert.doesNotMatch(capQuery, /is_progress_draw/);
  const page = readFileSync(new URL("../app/(app)/dashboard/invoices/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\.eq\("type", "invoice"\)/);
  assert.doesNotMatch(page, /is_progress_draw/);
});
