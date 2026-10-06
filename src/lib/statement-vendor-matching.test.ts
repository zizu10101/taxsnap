import assert from "node:assert/strict";
import test from "node:test";
import { candidateFor, matchRows, pickPreselect, rankCandidates, type MatchRow } from "./statement-matching.ts";
import { computeLineCandidates, type CandidateLine } from "./statement-candidates.ts";
import { vendorsMatch } from "./merchant-name.ts";

const row = (id: string, date: string, amount: number, vendor?: string): MatchRow => ({ id, date, amount, vendor });

// What the scanned invoice and the statement-created expense actually look like.
const INVOICE = "Rogers Communications Canada Inc."; // as Gemini reads the invoice
const CHARGE = "Rogers"; // the expense, after the merchant name was cleaned

// ---------------------------------------------------------------------------
// The preauthorised-debit case: invoice Feb 8, card charged Feb 22, same total
// ---------------------------------------------------------------------------

test("Feb 8 invoice / Feb 22 charge: matched as same vendor + same amount, 14 days apart", () => {
  const scan = row("scan", "2026-02-08", 89.99, INVOICE);
  const expense = row("exp", "2026-02-22", 89.99, CHARGE);

  const c = candidateFor(scan, expense);
  assert.deepEqual(c, { id: "exp", kind: "vendor", day_diff: 14, amount_diff: 0 });
  assert.equal(pickPreselect(rankCandidates(scan, [expense])), "exp");
});

test("...which the old rules missed: without a vendor, 14 days is outside every window", () => {
  assert.equal(candidateFor(row("scan", "2026-02-08", 89.99), row("exp", "2026-02-22", 89.99)), null);
});

test("the window is 30 days either way: day 30 matches, day 31 does not", () => {
  const scan = row("scan", "2026-03-15", 89.99, INVOICE);
  assert.equal(candidateFor(scan, row("a", "2026-04-14", 89.99, CHARGE))?.kind, "vendor"); // +30
  assert.equal(candidateFor(scan, row("b", "2026-02-13", 89.99, CHARGE))?.kind, "vendor"); // -30
  assert.equal(candidateFor(scan, row("c", "2026-04-15", 89.99, CHARGE)), null); // +31
  assert.equal(candidateFor(scan, row("d", "2026-02-12", 89.99, CHARGE)), null); // -31
});

test("a charge that comes BEFORE its invoice matches too (the window is symmetric)", () => {
  assert.equal(candidateFor(row("scan", "2026-02-22", 89.99, INVOICE), row("e", "2026-02-08", 89.99, CHARGE))?.kind, "vendor");
});

test("the long window needs the SAME amount to the cent", () => {
  const scan = row("scan", "2026-02-08", 89.99, INVOICE);
  assert.equal(candidateFor(scan, row("e", "2026-02-22", 90.0, CHARGE)), null);
  assert.equal(candidateFor(scan, row("e", "2026-02-22", 89.5, CHARGE)), null);
});

test("a different vendor with the same amount gets no long window", () => {
  assert.equal(candidateFor(row("scan", "2026-02-08", 89.99, "Bell Canada"), row("e", "2026-02-22", 89.99, CHARGE)), null);
});

// ---------------------------------------------------------------------------
// "Shell" must not be mistaken for "Shell Energy"
// ---------------------------------------------------------------------------

test("Shell and Shell Energy are different vendors", () => {
  assert.equal(vendorsMatch("Shell", "Shell Energy"), false);
  assert.equal(vendorsMatch("SHELL OIL 76 MISSISSAUGA ON", "Shell Energy Services"), false);
  // ...and the same vendor still matches itself across the usual noise.
  assert.equal(vendorsMatch("SHELL OIL 76 MISSISSAUGA ON", "Shell Oil 76"), true);
});

test("a Shell gas purchase is NOT offered a long-window match against a Shell Energy bill", () => {
  const scan = row("scan", "2026-02-08", 120, "Shell");
  const bill = row("bill", "2026-02-22", 120, "Shell Energy");
  assert.equal(candidateFor(scan, bill), null, "14 days apart and not the same vendor: no candidate at all");
  assert.equal(candidateFor(bill, scan), null, "and the other way round");
  assert.equal(matchRows([scan], [bill]).auto.size, 0);
});

test("close in time they are still offered, but as an ordinary same-amount guess - never as a vendor match", () => {
  const scan = row("scan", "2026-02-08", 120, "Shell");
  const bill = row("bill", "2026-02-10", 120, "Shell Energy");
  const c = candidateFor(scan, bill);
  assert.equal(c?.kind, "exact");
  assert.notEqual(c?.kind, "vendor");
});

test("a same-vendor match outranks a different-vendor same-amount guess nearer in time", () => {
  const scan = row("scan", "2026-02-08", 120, "Shell");
  const ranked = rankCandidates(scan, [
    row("energy", "2026-02-09", 120, "Shell Energy"), // 1 day, wrong vendor
    row("gas", "2026-02-22", 120, "SHELL OIL 76"), // 14 days, a different vendor too ("shell oil 76")
    row("shell", "2026-02-22", 120, "Shell"), // 14 days, the real one
  ]);
  assert.equal(ranked[0].id, "shell");
  assert.equal(ranked[0].kind, "vendor");
  assert.equal(ranked.find((c) => c.id === "energy")?.kind, "exact");
});

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

test("a vendor-and-amount match ranks above a close-amount guess that is nearer in time", () => {
  const scan = row("scan", "2026-02-08", 89.99, INVOICE);
  const ranked = rankCandidates(scan, [
    row("guess", "2026-02-08", 89.5, "Something Else"), // same day, close amount
    row("real", "2026-02-22", 89.99, CHARGE), // 14 days, same vendor and amount
  ]);
  assert.deepEqual(ranked.map((c) => [c.id, c.kind]), [["real", "vendor"], ["guess", "near"]]);
});

// ---------------------------------------------------------------------------
// Preselection: nearest wins, ties go to the person
// ---------------------------------------------------------------------------

test("two identical monthly bills: the nearest date is preselected", () => {
  // Jan's expense is still waiting for a receipt too. Scanning Feb's invoice (Feb 8):
  // Jan 22 is 17 days away, Feb 22 is 14.
  const scan = row("scan", "2026-02-08", 89.99, INVOICE);
  const ranked = rankCandidates(scan, [row("jan", "2026-01-22", 89.99, CHARGE), row("feb", "2026-02-22", 89.99, CHARGE)]);
  assert.deepEqual(ranked.map((c) => [c.id, c.day_diff]), [["feb", 14], ["jan", 17]]);
  assert.equal(pickPreselect(ranked), "feb");
});

test("an expense that already has a receipt is not in the pool, so only the other one is offered", () => {
  const scan = row("scan", "2026-02-08", 89.99, INVOICE);
  // Jan's expense had its receipt attached already, so the caller never passes it in.
  const ranked = rankCandidates(scan, [row("feb", "2026-02-22", 89.99, CHARGE)]);
  assert.equal(ranked.length, 1);
  assert.equal(pickPreselect(ranked), "feb");
});

test("an equal-distance tie preselects nothing - both are listed for the person to choose", () => {
  const scan = row("scan", "2026-02-07", 89.99, INVOICE);
  const ranked = rankCandidates(scan, [row("jan", "2026-01-24", 89.99, CHARGE), row("feb", "2026-02-21", 89.99, CHARGE)]); // 14 and 14
  assert.equal(ranked.length, 2);
  assert.equal(pickPreselect(ranked), null);
});

test("the tie margin is 2 days: a 2-day difference is a tie, 3 days is a clear winner", () => {
  const scan = row("scan", "2026-02-08", 89.99, INVOICE);
  const tie = rankCandidates(scan, [row("a", "2026-02-21", 89.99, CHARGE), row("b", "2026-01-24", 89.99, CHARGE)]); // 13 and 15
  assert.equal(pickPreselect(tie), null);
  const clear = rankCandidates(scan, [row("a", "2026-02-21", 89.99, CHARGE), row("b", "2026-01-23", 89.99, CHARGE)]); // 13 and 16
  assert.equal(pickPreselect(clear), "a");
});

test("only the matching month is a candidate when the other is out of the window", () => {
  const scan = row("scan", "2026-01-08", 89.99, INVOICE);
  const ranked = rankCandidates(scan, [row("jan", "2026-01-22", 89.99, CHARGE), row("feb", "2026-02-22", 89.99, CHARGE)]); // 14 and 45
  assert.deepEqual(ranked.map((c) => c.id), ["jan"]);
  assert.equal(pickPreselect(ranked), "jan");
});

test("preselection rules for the other kinds are unchanged: a lone exact match, never a near guess", () => {
  assert.equal(pickPreselect(rankCandidates(row("s", "2026-03-14", 20), [row("a", "2026-03-15", 20)])), "a");
  assert.equal(
    pickPreselect(rankCandidates(row("s", "2026-03-14", 20), [row("a", "2026-03-15", 20), row("b", "2026-03-13", 20)])),
    null,
  );
  assert.equal(pickPreselect(rankCandidates(row("s", "2026-03-14", 100), [row("a", "2026-03-14", 104)])), null);
  assert.equal(pickPreselect([]), null);
});

// ---------------------------------------------------------------------------
// Import side: the same rules, with mutual-nearest auto-accept
// ---------------------------------------------------------------------------

test("import: the Feb 22 charge and the Feb 8 invoice are matched automatically", () => {
  const { auto, ask } = matchRows([row("line", "2026-02-22", 89.99, "ROGERS *************3771")], [row("rcpt", "2026-02-08", 89.99, INVOICE)]);
  assert.equal(auto.get("line"), "rcpt");
  assert.equal(ask.size, 0);
});

test("import: two identical monthly bills pair off one-to-one by nearest date", () => {
  const lines = [row("jan-line", "2026-01-22", 89.99, "ROGERS *************3771"), row("feb-line", "2026-02-22", 89.99, "ROGERS *************3771")];
  const receipts = [row("jan-inv", "2026-01-08", 89.99, INVOICE), row("feb-inv", "2026-02-08", 89.99, INVOICE)];
  const { auto, ask } = matchRows(lines, receipts);
  assert.equal(ask.size, 0);
  assert.equal(auto.get("jan-line"), "jan-inv");
  assert.equal(auto.get("feb-line"), "feb-inv");
  assert.equal(new Set(auto.values()).size, 2, "one-to-one");
});

test("import: with only one of the invoices scanned, the other month's line is not wrongly paired with it", () => {
  // Only February's invoice exists. January's line is 17 days from it, February's is 14.
  const { auto, ask } = matchRows(
    [row("jan-line", "2026-01-22", 89.99, "ROGERS"), row("feb-line", "2026-02-22", 89.99, "ROGERS")],
    [row("feb-inv", "2026-02-08", 89.99, INVOICE)],
  );
  assert.equal(auto.get("feb-line"), "feb-inv", "the nearer line wins the receipt");
  assert.equal(auto.has("jan-line"), false, "and the farther one is not given the same receipt");
  assert.ok(!ask.has("feb-line"));
  assert.ok(!ask.has("jan-line"), "nor is that receipt offered to it as a choice - one-to-one");
});

test("import: an equal-distance tie is asked, never auto-matched", () => {
  const { auto, ask } = matchRows(
    [row("line", "2026-02-10", 89.99, "ROGERS")],
    [row("a", "2026-01-27", 89.99, INVOICE), row("b", "2026-02-24", 89.99, INVOICE)], // 14 and 14
  );
  assert.equal(auto.size, 0);
  assert.equal(ask.get("line")?.length, 2);
});

test("import: two near-identical charges competing for one invoice are both asked", () => {
  const { auto, ask } = matchRows(
    [row("l1", "2026-02-20", 89.99, "ROGERS"), row("l2", "2026-02-22", 89.99, "ROGERS")], // 12 and 14 days from the invoice
    [row("inv", "2026-02-08", 89.99, INVOICE)],
  );
  assert.equal(auto.size, 0);
  assert.ok(ask.has("l1") && ask.has("l2"));
});

test("import: a near (close-amount) match is still never auto-accepted", () => {
  assert.equal(matchRows([row("l", "2026-03-14", 100, "X")], [row("r", "2026-03-14", 104, "X")]).auto.size, 0);
});

test("import: Shell gas and a Shell Energy bill 14 days apart are not paired", () => {
  const { auto, ask } = matchRows([row("gas", "2026-02-22", 120, "SHELL OIL 76 MISSISSAUGA ON")], [row("bill", "2026-02-08", 120, "Shell Energy")]);
  assert.equal(auto.size + ask.size, 0);
});

test("computeLineCandidates passes the statement description through as the vendor", () => {
  const line: CandidateLine = {
    id: "l1",
    txn_date: "2026-02-22",
    amount: 89.99,
    description: "ROGERS *************3771",
    kind: "purchase",
    resolution: null,
    duplicate_of_line_id: null,
    duplicate_override: false,
  };
  const { auto } = computeLineCandidates([line], [row("r1", "2026-02-08", 89.99, INVOICE)], new Map());
  assert.equal(auto.get("l1"), "r1");
});
