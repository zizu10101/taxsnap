import assert from "node:assert/strict";
import test from "node:test";
import { canSave, groupOf, needsDecision, summarize, type ReviewLine } from "./statement-review-model.ts";

function line(overrides: Partial<ReviewLine> = {}): ReviewLine {
  return {
    id: "l",
    kind: "purchase",
    amount: 10,
    resolution: null,
    category: null,
    category_confirmed: false,
    duplicate_of_line_id: null,
    duplicate_override: false,
    candidate_count: 0,
    ...overrides,
  };
}

test("grouping follows the documented priority", () => {
  assert.equal(groupOf(line({ duplicate_of_line_id: "x", resolution: "skipped" })), "already_imported");
  assert.equal(groupOf(line({ kind: "payment", amount: -5, resolution: "skipped" })), "payments");
  assert.equal(groupOf(line({ resolution: "skipped" })), "excluded");
  assert.equal(groupOf(line({ resolution: "matched" })), "matched");
  assert.equal(groupOf(line({ kind: "refund", amount: -5 })), "refunds");
  assert.equal(groupOf(line({ kind: "interest" })), "bank_charges");
  assert.equal(groupOf(line({ kind: "fee" })), "bank_charges");
  assert.equal(groupOf(line({ candidate_count: 2 })), "possible_matches");
  assert.equal(groupOf(line()), "new");
});

test("overriding a duplicate moves it out of 'already imported'", () => {
  assert.equal(
    groupOf(line({ duplicate_of_line_id: "x", duplicate_override: true, resolution: "new_expense" })),
    "new",
  );
});

test("a line with candidates stops being a 'possible match' once the user decides", () => {
  assert.equal(groupOf(line({ candidate_count: 2, resolution: "new_expense" })), "new");
});

test("an undecided line needs a decision; a skipped payment does not", () => {
  assert.equal(needsDecision(line()), true);
  assert.equal(needsDecision(line({ kind: "payment", amount: -5, resolution: "skipped" })), false);
  assert.equal(needsDecision(line({ resolution: "skipped" })), false);
  assert.equal(needsDecision(line({ resolution: "matched" })), false);
});

test("a new expense needs an accepted category, not just a suggestion", () => {
  assert.equal(needsDecision(line({ resolution: "new_expense", category: null })), true);
  assert.equal(needsDecision(line({ resolution: "new_expense", category: "Supplies", category_confirmed: false })), true);
  assert.equal(needsDecision(line({ resolution: "new_expense", category: "Supplies", category_confirmed: true })), false);
});

test("summarize counts what will happen and how many are already imported", () => {
  const s = summarize([
    line({ resolution: "matched" }),
    line({ resolution: "new_expense", category: "Supplies", category_confirmed: true }),
    line({ resolution: "skipped", duplicate_of_line_id: "x" }),
    line({ resolution: "skipped" }),
    line(),
  ]);
  assert.deepEqual(s, { total: 5, needsDecision: 1, willMatch: 1, willCreate: 1, willSkip: 2, alreadyImported: 1 });
});

test("save needs every line decided, and an acknowledgement when the total is off", () => {
  const decided = [line({ resolution: "matched" })];
  const matches = { status: "matches", basis: "balance_roll", expected: 1, extracted: 1, diff: 0 } as const;
  const off = { status: "off", basis: "balance_roll", expected: 1, extracted: 2, diff: 1 } as const;
  assert.equal(canSave(decided, matches, false), true);
  assert.equal(canSave(decided, { status: "no_total" }, false), true);
  assert.equal(canSave(decided, off, false), false);
  assert.equal(canSave(decided, off, true), true);
  assert.equal(canSave([line()], matches, true), false);
  assert.equal(canSave([], matches, true), false);
});
