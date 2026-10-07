import assert from "node:assert/strict";
import test from "node:test";
import { candidateFor, matchRows, rankCandidates, type MatchRow } from "./statement-matching.ts";

const row = (id: string, date: string, amount: number) => ({ id, date, amount });

test("same amount within 3 days is an exact candidate (3 in, 4 out of the window)", () => {
  assert.equal(candidateFor(row("l", "2026-03-14", 48.2), row("r", "2026-03-11", 48.2))?.kind, "exact");
  assert.equal(candidateFor(row("l", "2026-03-14", 48.2), row("r", "2026-03-17", 48.2))?.kind, "exact");
  // 4 days apart is no longer exact, but is a near match (a late-posting charge).
  assert.equal(candidateFor(row("l", "2026-03-14", 48.2), row("r", "2026-03-18", 48.2))?.kind, "near");
  assert.equal(candidateFor(row("l", "2026-03-14", 48.2), row("r", "2026-03-22", 48.2)), null);
});

test("amounts are compared to the cent, not as floats", () => {
  assert.equal(candidateFor(row("l", "2026-03-14", 0.1 + 0.2), row("r", "2026-03-14", 0.3))?.kind, "exact");
  assert.equal(candidateFor(row("l", "2026-03-14", 10.0), row("r", "2026-03-14", 10.01))?.kind, "near");
});

test("a different amount is only ever a near match, within $1 or 5%", () => {
  // $100 -> 5% = $5 tolerance
  assert.equal(candidateFor(row("l", "2026-03-14", 100), row("r", "2026-03-14", 104))?.kind, "near");
  assert.equal(candidateFor(row("l", "2026-03-14", 100), row("r", "2026-03-14", 106)), null);
  // $10 -> $1 flat tolerance
  assert.equal(candidateFor(row("l", "2026-03-14", 10), row("r", "2026-03-14", 10.9))?.kind, "near");
  assert.equal(candidateFor(row("l", "2026-03-14", 10), row("r", "2026-03-14", 11.5)), null);
});

test("a lone exact match that nothing else wants is accepted automatically", () => {
  const { auto, ask } = matchRows([row("l1", "2026-03-14", 48.2)], [row("r1", "2026-03-13", 48.2)]);
  assert.equal(auto.get("l1"), "r1");
  assert.equal(ask.size, 0);
});

test("two receipts that could both be the line is a tie: nothing is auto-matched", () => {
  const { auto, ask } = matchRows(
    [row("l1", "2026-03-14", 20)],
    [row("r1", "2026-03-13", 20), row("r2", "2026-03-15", 20)],
  );
  assert.equal(auto.size, 0);
  assert.equal(ask.get("l1")?.length, 2);
});

test("two lines competing for one receipt is a tie for both", () => {
  const { auto, ask } = matchRows(
    [row("l1", "2026-03-14", 20), row("l2", "2026-03-15", 20)],
    [row("r1", "2026-03-14", 20)],
  );
  assert.equal(auto.size, 0);
  assert.equal(ask.get("l1")?.length, 1);
  assert.equal(ask.get("l2")?.length, 1);
});

test("a near match is never auto-accepted, even when it is the only candidate", () => {
  const { auto, ask } = matchRows([row("l1", "2026-03-14", 100)], [row("r1", "2026-03-14", 104)]);
  assert.equal(auto.size, 0);
  assert.equal(ask.get("l1")?.[0].kind, "near");
});

test("an exact candidate plus a near one is not auto-accepted", () => {
  const { auto, ask } = matchRows(
    [row("l1", "2026-03-14", 100)],
    [row("r1", "2026-03-14", 100), row("r2", "2026-03-14", 103)],
  );
  assert.equal(auto.size, 0);
  assert.deepEqual(ask.get("l1")?.map((c) => c.id), ["r1", "r2"]);
});

test("one-to-one: no pool row is auto-assigned to two targets", () => {
  const targets = [row("l1", "2026-03-10", 15), row("l2", "2026-03-20", 15), row("l3", "2026-03-14", 33)];
  const pool = [row("r1", "2026-03-10", 15), row("r2", "2026-03-21", 15), row("r3", "2026-03-15", 33)];
  const { auto } = matchRows(targets, pool);
  assert.equal(auto.size, 3);
  assert.equal(new Set(auto.values()).size, 3);
});

test("no candidates means no entry at all", () => {
  const { auto, ask } = matchRows([row("l1", "2026-03-14", 48.2)], [row("r1", "2026-05-01", 48.2)]);
  assert.equal(auto.size + ask.size, 0);
});

test("candidates are ranked exact first, then by amount gap, then by days", () => {
  const ranked = rankCandidates(row("l", "2026-03-14", 100), [
    row("near", "2026-03-14", 103),
    row("exact-far", "2026-03-17", 100),
    row("exact-close", "2026-03-14", 100),
  ]);
  assert.deepEqual(ranked.map((c) => c.id), ["exact-close", "exact-far", "near"]);
});

// ---- a near match is NOT symmetric: the tolerance comes from the target's own amount ------------------

import { computeLineCandidates, type CandidateLine } from "./statement-candidates.ts";

const loose = { line: (id: string, date: string, amount = 100): MatchRow => ({ id, date, amount, vendor: "ACME" }) };
const receipt952: MatchRow = { id: "r1", date: "2026-02-10", amount: 95.2, vendor: "Other Co" };

test("the asymmetry is real: $100.00 loosely matches $95.20, but $95.20 does not loosely match $100.00", () => {
  const forward = candidateFor(loose.line("a", "2026-02-10"), receipt952);
  assert.equal(forward?.kind, "near");
  assert.equal(forward?.amount_diff, 4.8, "within 5% of the LINE's $100.00 (5.00)");
  assert.equal(candidateFor(receipt952, loose.line("a", "2026-02-10")), null, "but not within 5% of the receipt's $95.20 (4.76)");
});

test("two $100.00 lines and one $95.20 receipt on nearby days no longer crash (was TypeError reading 'kind')", () => {
  const result = matchRows([loose.line("lineA", "2026-02-10"), loose.line("lineB", "2026-02-11")], [receipt952]);
  // Near is never accepted automatically; both lines are simply OFFERED the receipt.
  assert.equal(result.auto.size, 0);
  assert.deepEqual([...result.ask.keys()].sort(), ["lineA", "lineB"]);
  for (const list of result.ask.values()) {
    assert.deepEqual(list.map((c) => [c.id, c.kind]), [["r1", "near"]]);
  }
});

test("the same input through the review page's own entry point (computeLineCandidates)", () => {
  const lines: CandidateLine[] = ["lineA", "lineB"].map((id, i) => ({
    id,
    txn_date: `2026-02-1${i}`,
    amount: 100,
    description: "ACME",
    kind: "purchase",
    resolution: null,
    duplicate_of_line_id: null,
    duplicate_override: false,
  }));
  const { auto, candidates } = computeLineCandidates(lines, [receipt952], new Map());
  assert.equal(auto.size, 0);
  assert.deepEqual([...candidates.keys()].sort(), ["lineA", "lineB"]);
});

test("a loose competitor still stops an EXACT (same amount, other vendor) match being accepted automatically", () => {
  // Line X is exactly $95.20 but a different vendor; line Y ($100.00) loosely matches the same receipt.
  // As with any rival candidate, an exact match is not accepted on its own - the person chooses.
  const result = matchRows(
    [{ id: "X", date: "2026-02-10", amount: 95.2, vendor: "Someone Else" }, loose.line("Y", "2026-02-11")],
    [receipt952],
  );
  assert.equal(result.auto.size, 0);
  assert.ok(result.ask.get("X")?.some((c) => c.id === "r1"));
  assert.ok(result.ask.get("Y")?.some((c) => c.id === "r1"));
});

test("a same-vendor, same-amount match still outranks a loose guess and is accepted (by design: lower kinds don't count)", () => {
  const result = matchRows(
    [{ id: "X", date: "2026-02-10", amount: 95.2, vendor: "Other Co" }, loose.line("Y", "2026-02-11")],
    [receipt952],
  );
  assert.deepEqual([...result.auto], [["X", "r1"]]);
});

test("a lone exact match is still accepted automatically when nothing loosely competes", () => {
  const result = matchRows([{ id: "X", date: "2026-02-10", amount: 95.2, vendor: "Other Co" }], [receipt952]);
  assert.deepEqual([...result.auto], [["X", "r1"]]);
});

test("many lines loosely matching many receipts (the review page at scale) never throws", () => {
  const lines: MatchRow[] = Array.from({ length: 40 }, (_, i) => ({ id: `l${i}`, date: `2026-02-${String(1 + (i % 28)).padStart(2, "0")}`, amount: 100 + (i % 3), vendor: "V" }));
  const pool: MatchRow[] = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, date: `2026-02-${String(1 + (i % 28)).padStart(2, "0")}`, amount: 95 + (i % 7) * 0.4, vendor: "W" }));
  assert.doesNotThrow(() => matchRows(lines, pool));
});
