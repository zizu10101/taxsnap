import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupSpendingByAccount,
  matchesAccountFilter,
  NOT_SPECIFIED,
  type SpendAccount,
} from "./account-spending.ts";

const accounts: SpendAccount[] = [
  { id: "chq", name: "Business Checking", account_type: "bank", is_active: true },
  { id: "visa", name: "Visa 1234", account_type: "card", is_active: true },
  { id: "old", name: "Old Card", account_type: "card", is_active: false },
  { id: "idle", name: "Idle Account", is_active: true },
];

const receipts = [
  { total_amount: 100, paid_with_account_id: "visa" },
  { total_amount: 50.5, paid_with_account_id: "visa" },
  { total_amount: 20, paid_with_account_id: "chq" },
  { total_amount: 30, paid_with_account_id: null },
  { total_amount: 5, paid_with_account_id: "old" },
];

test("rows add up to every expense, so totals never understate spending", () => {
  const { rows, total } = groupSpendingByAccount(receipts, accounts);
  assert.equal(total, 205.5);
  assert.equal(rows.reduce((s, r) => s + r.total, 0), 205.5);
});

test("'Not specified' is its own visible row, with its spend", () => {
  const row = groupSpendingByAccount(receipts, accounts).rows.find((r) => r.key === NOT_SPECIFIED);
  assert.ok(row);
  assert.equal(row.total, 30);
  assert.equal(row.count, 1);
});

test("'Not specified' is shown even when nothing is unassigned ($0), and so is an idle active account", () => {
  const { rows } = groupSpendingByAccount([{ total_amount: 10, paid_with_account_id: "chq" }], accounts);
  assert.equal(rows.find((r) => r.key === NOT_SPECIFIED)?.total, 0);
  assert.equal(rows.find((r) => r.key === "idle")?.count, 0);
});

test("a deactivated account shows only while it still has spend in the range", () => {
  assert.ok(groupSpendingByAccount(receipts, accounts).rows.some((r) => r.key === "old"));
  assert.ok(!groupSpendingByAccount([], accounts).rows.some((r) => r.key === "old"));
});

test("spend on an account no longer in the list is grouped, not dropped", () => {
  const { rows, total } = groupSpendingByAccount(
    [{ total_amount: 7, paid_with_account_id: "gone" }],
    accounts,
  );
  assert.equal(total, 7);
  assert.equal(rows.find((r) => r.key === "gone")?.name, "Removed account");
});

test("sorted by spend, highest first; cards and banks are typed, 'Not specified' is untyped", () => {
  const { rows } = groupSpendingByAccount(receipts, accounts);
  assert.equal(rows[0].key, "visa");
  assert.equal(rows[0].type, "card");
  assert.equal(rows.find((r) => r.key === "idle")?.type, "bank");
  assert.equal(rows.find((r) => r.key === NOT_SPECIFIED)?.type, null);
});

test("account filter: an id matches only that account, 'none' only unassigned expenses", () => {
  assert.equal(matchesAccountFilter("visa", "visa"), true);
  assert.equal(matchesAccountFilter("chq", "visa"), false);
  assert.equal(matchesAccountFilter(null, NOT_SPECIFIED), true);
  assert.equal(matchesAccountFilter("visa", NOT_SPECIFIED), false);
});
