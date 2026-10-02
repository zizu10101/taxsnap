import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountDisplayName,
  accountTypeOf,
  depositAccounts,
  paidWithAccounts,
  type AccountLike,
} from "./accounts.ts";

const accounts: AccountLike[] = [
  { id: "chq", name: "Business Checking", is_active: true, account_type: "bank" },
  { id: "visa", name: "Visa 1234", is_active: true, account_type: "card" },
  { id: "old", name: "Old Savings", is_active: false, account_type: "bank" },
  { id: "legacy", name: "Pre-0048", is_active: true },
];

test("an account with no type (predating 0048) is a bank account", () => {
  assert.equal(accountTypeOf(accounts[3]), "bank");
});

test("Deposited to offers active bank accounts only - never a card", () => {
  assert.deepEqual(depositAccounts(accounts).map((a) => a.id), ["chq", "legacy"]);
});

test("Deposited to still shows a payment's own account if inactive or a card", () => {
  assert.deepEqual(depositAccounts(accounts, "old").map((a) => a.id), ["chq", "old", "legacy"]);
  assert.ok(depositAccounts(accounts, "visa").some((a) => a.id === "visa"));
});

test("Paid with offers every active account, plus the expense's own current one", () => {
  assert.deepEqual(paidWithAccounts(accounts).map((a) => a.id), ["chq", "visa", "legacy"]);
  assert.deepEqual(paidWithAccounts(accounts, "old").map((a) => a.id), ["chq", "visa", "old", "legacy"]);
});

test("display names mark credit cards (when asked) and inactive accounts", () => {
  assert.equal(accountDisplayName(accounts[1], { withType: true }), "Visa 1234 (credit card)");
  assert.equal(accountDisplayName(accounts[1]), "Visa 1234");
  assert.equal(accountDisplayName(accounts[2], { withType: true }), "Old Savings (inactive)");
});
