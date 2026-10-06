import assert from "node:assert/strict";
import test from "node:test";
import { computeLineCandidates, isMatchable, type CandidateLine } from "./statement-candidates.ts";

function line(id: string, date: string, amount: number, overrides: Partial<CandidateLine> = {}): CandidateLine {
  return {
    id,
    txn_date: date,
    amount,
    kind: "purchase",
    resolution: null,
    duplicate_of_line_id: null,
    duplicate_override: false,
    ...overrides,
  };
}
const r = (id: string, date: string, amount: number) => ({ id, date, amount });

test("only positive purchase/other lines that are still open are matchable", () => {
  assert.equal(isMatchable(line("a", "2026-03-14", 10)), true);
  assert.equal(isMatchable(line("a", "2026-03-14", 10, { kind: "other" })), true);
  assert.equal(isMatchable(line("a", "2026-03-14", -10, { kind: "refund" })), false);
  assert.equal(isMatchable(line("a", "2026-03-14", 10, { kind: "interest" })), false);
  assert.equal(isMatchable(line("a", "2026-03-14", 10, { kind: "fee" })), false);
  assert.equal(isMatchable(line("a", "2026-03-14", 10, { resolution: "matched" })), false);
  assert.equal(isMatchable(line("a", "2026-03-14", 10, { resolution: "skipped" })), false);
});

test("a flagged duplicate is not matchable until the user overrides it", () => {
  assert.equal(isMatchable(line("a", "2026-03-14", 10, { duplicate_of_line_id: "x" })), false);
  assert.equal(isMatchable(line("a", "2026-03-14", 10, { duplicate_of_line_id: "x", duplicate_override: true })), true);
});

test("a receipt already claimed by another line is never offered", () => {
  const { auto, candidates } = computeLineCandidates(
    [line("l1", "2026-03-14", 20)],
    [r("r1", "2026-03-14", 20), r("r2", "2026-03-15", 20)],
    new Map([["r1", "other-line"]]),
  );
  assert.equal(auto.get("l1"), "r2");
  assert.equal(candidates.size, 0);
});

test("a tie yields candidates and no auto match", () => {
  const { auto, candidates } = computeLineCandidates(
    [line("l1", "2026-03-14", 20)],
    [r("r1", "2026-03-14", 20), r("r2", "2026-03-15", 20)],
    new Map(),
  );
  assert.equal(auto.size, 0);
  assert.equal(candidates.get("l1")?.length, 2);
});

test("a line already chosen as a new expense is offered candidates but never auto-matched", () => {
  const { auto, candidates } = computeLineCandidates(
    [line("l1", "2026-03-14", 20, { resolution: "new_expense" })],
    [r("r1", "2026-03-14", 20)],
    new Map(),
  );
  assert.equal(auto.size, 0);
  assert.equal(candidates.get("l1")?.[0].id, "r1");
});

test("matched, skipped and refund lines get nothing", () => {
  const { auto, candidates } = computeLineCandidates(
    [
      line("m", "2026-03-14", 20, { resolution: "matched" }),
      line("s", "2026-03-14", 20, { resolution: "skipped" }),
      line("f", "2026-03-14", -20, { kind: "refund" }),
    ],
    [r("r1", "2026-03-14", 20)],
    new Map(),
  );
  assert.equal(auto.size + candidates.size, 0);
});
