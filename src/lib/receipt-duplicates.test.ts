import assert from "node:assert/strict";
import test from "node:test";
import { similarReceipts, type DuplicateSummary } from "./receipt-duplicates.ts";
import { vendorKey } from "./merchant-name.ts";

const rec = (id: string, merchant: string, date: string, total: number, extra: object = {}) => ({
  id,
  merchant_name: merchant,
  transaction_date: date,
  total_amount: total,
  ...extra,
});
const candidate = { merchant: "Rogers Communications Canada Inc.", total: 89.99, date: "2026-02-08" };

// ---------------------------------------------------------------------------
// Merchant identity: the duplicate check uses the statement matcher's vendorKey - ONE rule
// ---------------------------------------------------------------------------

const asScan = (merchant: string) => ({ merchant, total: 50, date: "2026-02-08" });
const saved = (merchant: string) => [rec("r", merchant, "2026-02-08", 50)];

test("case, punctuation, store numbers and trailing legal/generic words don't make two merchants different", () => {
  assert.equal(similarReceipts(asScan("HOME DEPOT #7042"), saved("Home Depot #7013")).length, 1);
  assert.equal(similarReceipts(asScan("Tim Horton's"), saved("TIM HORTONS")).length, 1);
  assert.equal(similarReceipts(asScan("A&W"), saved("A & W")).length, 1);
  assert.equal(similarReceipts(asScan("Acme Supply Ltd."), saved("acme supply")).length, 1);
});

test("the receipt's long legal name and the card statement's short one are the same merchant (vendorKey drops Communications / Canada / Inc)", () => {
  assert.equal(similarReceipts(asScan("Rogers Communications Canada Inc."), saved("Rogers")).length, 1);
  assert.equal(similarReceipts(asScan("ROGERS *************3771"), saved("Rogers Communications")).length, 1);
});

test("the duplicate check and the statement matcher can't disagree: it matches exactly when the vendor keys are equal", () => {
  const pairs: [string, string][] = [
    ["Rogers Communications Canada Inc.", "Rogers"],
    ["HOME DEPOT #7042 TORONTO ON", "Home Depot"],
    ["Shell", "Shell Energy"],
    ["Home Depot", "Home Hardware"],
    ["The Home Depot", "Home Depot"],
    ["Staples", "Rogers"],
  ];
  for (const [a, b] of pairs) {
    const sameKey = vendorKey(a) !== null && vendorKey(a) === vendorKey(b);
    assert.equal(similarReceipts(asScan(a), saved(b)).length === 1, sameKey, a + " / " + b);
  }
});

test("a leading 'the' is deliberately kept (no fuzzy matching)", () => {
  assert.notEqual(vendorKey("The Home Depot"), vendorKey("Home Depot"));
});

test("nothing to compare (an empty or all-noise merchant) never matches anything", () => {
  assert.equal(similarReceipts(asScan(""), saved("Rogers")).length, 0);
  assert.equal(similarReceipts(asScan("   "), saved("Rogers")).length, 0);
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
