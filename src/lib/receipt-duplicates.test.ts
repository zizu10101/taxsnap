import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMerchant, similarReceipts, type DuplicateSummary } from "./receipt-duplicates.ts";

const rec = (id: string, merchant: string, date: string, total: number, extra: object = {}) => ({
  id,
  merchant_name: merchant,
  transaction_date: date,
  total_amount: total,
  ...extra,
});
const candidate = { merchant: "Rogers Communications Canada Inc.", total: 89.99, date: "2026-02-08" };

// ---------------------------------------------------------------------------
// The merchant normaliser
// ---------------------------------------------------------------------------

test("normalizeMerchant: case, punctuation, store numbers and trailing legal words don't matter", () => {
  assert.equal(normalizeMerchant("Rogers Communications Canada Inc."), "rogers communications canada");
  assert.equal(normalizeMerchant("ROGERS COMMUNICATIONS CANADA INC"), "rogers communications canada");
  assert.equal(normalizeMerchant("HOME DEPOT #7042"), normalizeMerchant("Home Depot #7013"));
  assert.equal(normalizeMerchant("Tim Horton's"), normalizeMerchant("TIM HORTONS"));
  assert.equal(normalizeMerchant("A&W"), normalizeMerchant("A & W"));
  assert.equal(normalizeMerchant("Acme Supply Ltd."), "acme supply");
});

test("normalizeMerchant: never strips the last word, and gives null for nothing to compare", () => {
  assert.equal(normalizeMerchant("Inc"), "inc");
  assert.equal(normalizeMerchant(""), null);
  assert.equal(normalizeMerchant("   "), null);
  assert.equal(normalizeMerchant(null), null);
  assert.equal(normalizeMerchant("#### 1234"), null);
});

test("normalizeMerchant: a LEADING 'the' is deliberately kept (no fuzzy matching)", () => {
  assert.notEqual(normalizeMerchant("The Home Depot"), normalizeMerchant("Home Depot"));
});

// ---------------------------------------------------------------------------
// The soft warning: same merchant + same total + date within 2 days
// ---------------------------------------------------------------------------

test("a different file with the same merchant, total and date is a possible duplicate", () => {
  // The existing row was scanned from some other file entirely - the file hash plays no part here.
  const found = similarReceipts(candidate, [rec("r1", "Rogers Communications Canada Inc.", "2026-02-08", 89.99)]);
  assert.deepEqual(found, [
    { id: "r1", merchant_name: "Rogers Communications Canada Inc.", transaction_date: "2026-02-08", total_amount: 89.99 },
  ]);
});

test("the date window is 2 days either way: day 2 warns, day 3 doesn't", () => {
  const rows = [
    rec("minus2", "Rogers Communications Canada Inc.", "2026-02-06", 89.99),
    rec("plus2", "Rogers Communications Canada Inc.", "2026-02-10", 89.99),
    rec("minus3", "Rogers Communications Canada Inc.", "2026-02-05", 89.99),
    rec("plus3", "Rogers Communications Canada Inc.", "2026-02-11", 89.99),
  ];
  assert.deepEqual(similarReceipts(candidate, rows).map((r) => r.id).sort(), ["minus2", "plus2"]);
});

test("the total must match to the cent", () => {
  assert.equal(similarReceipts(candidate, [rec("a", "Rogers Communications Canada Inc.", "2026-02-08", 89.98)]).length, 0);
  assert.equal(similarReceipts(candidate, [rec("a", "Rogers Communications Canada Inc.", "2026-02-08", 90)]).length, 0);
  assert.equal(similarReceipts({ ...candidate, total: 0.1 + 0.2 }, [rec("a", "Rogers Communications Canada Inc.", "2026-02-08", 0.3)]).length, 1);
});

test("a different merchant with the same total and date is not a duplicate", () => {
  assert.equal(similarReceipts(candidate, [rec("a", "Staples", "2026-02-08", 89.99)]).length, 0);
});

test("look-alike merchants are different: Shell vs Shell Energy", () => {
  const shell = { merchant: "Shell", total: 120, date: "2026-02-08" };
  assert.equal(similarReceipts(shell, [rec("a", "Shell Energy", "2026-02-08", 120)]).length, 0);
  assert.equal(similarReceipts(shell, [rec("b", "SHELL", "2026-02-09", 120)]).length, 1);
});

test("a missed match for a leading 'the' is accepted (soft warning, no fuzzy matching)", () => {
  assert.equal(
    similarReceipts({ merchant: "Home Depot", total: 50, date: "2026-02-08" }, [rec("a", "The Home Depot", "2026-02-08", 50)]).length,
    0,
  );
});

test("refunds and a zero or negative candidate never warn", () => {
  assert.equal(similarReceipts(candidate, [rec("a", "Rogers Communications Canada Inc.", "2026-02-08", -89.99)]).length, 0);
  assert.equal(similarReceipts({ ...candidate, total: -89.99 }, [rec("a", "Rogers Communications Canada Inc.", "2026-02-08", 89.99)]).length, 0);
  assert.equal(similarReceipts({ ...candidate, total: 0 }, [rec("a", "Rogers Communications Canada Inc.", "2026-02-08", 0)]).length, 0);
});

test("a statement expense still waiting for its receipt is not a saved receipt", () => {
  const rows = [rec("waiting", "Rogers", "2026-02-08", 89.99, { no_receipt: true }), rec("saved", "Rogers", "2026-02-08", 89.99, { no_receipt: false })];
  assert.deepEqual(similarReceipts({ ...candidate, merchant: "Rogers" }, rows).map((r) => r.id), ["saved"]);
});

test("nearest date first, at most 3 shown", () => {
  const rows = [
    rec("d2", "Rogers", "2026-02-10", 89.99),
    rec("d0", "Rogers", "2026-02-08", 89.99),
    rec("d1", "Rogers", "2026-02-09", 89.99),
    rec("d1b", "Rogers", "2026-02-07", 89.99),
  ];
  const found = similarReceipts({ ...candidate, merchant: "Rogers" }, rows);
  assert.equal(found.length, 3);
  assert.equal(found[0].id, "d0");
});

test("garbage input yields no warning rather than a crash", () => {
  const rows: DuplicateSummary[] = [rec("a", "Rogers", "2026-02-08", 89.99)];
  assert.deepEqual(similarReceipts({ merchant: "", total: 89.99, date: "2026-02-08" }, rows), []);
  assert.deepEqual(similarReceipts({ merchant: "Rogers", total: 89.99, date: "Feb 8" }, rows), []);
  assert.deepEqual(similarReceipts({ merchant: "Rogers", total: Number.NaN, date: "2026-02-08" }, rows), []);
});
