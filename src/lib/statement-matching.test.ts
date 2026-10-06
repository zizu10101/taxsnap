import assert from "node:assert/strict";
import test from "node:test";
import { candidateFor, matchRows, rankCandidates } from "./statement-matching.ts";

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
