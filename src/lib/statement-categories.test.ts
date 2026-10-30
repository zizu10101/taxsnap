import assert from "node:assert/strict";
import test from "node:test";
import {
  bankChargesSuggestion,
  resolveBankCharges,
  resolveStatementCategory,
  statementCategoryOptions,
  type CategoryRow,
} from "./statement-categories.ts";

const row = (name: string, over: Partial<CategoryRow> = {}): CategoryRow => ({ name, is_active: true, ...over });
const KEYED = (name: string, active = true): CategoryRow => row(name, { is_active: active, system_key: "bank_charges" });

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

test("options are the built-ins (bank charges among them), and the owner's own", () => {
  const options = statementCategoryOptions([row("Permits")]);
  assert.ok(options.includes("Materials & Supplies"));
  assert.ok(options.includes("Permits"));
  assert.ok(options.includes("Bank Charges & Interest"));
});

test("an owner's own 'bank charges' category is the built-in now: it is not offered a second time", () => {
  const options = statementCategoryOptions([row("bank charges")]);
  assert.equal(options.filter((o) => o.toLowerCase().startsWith("bank charges")).length, 1);
  assert.ok(options.includes("Bank Charges & Interest"));
});

test("an inactive custom category is not offered", () => {
  const options = statementCategoryOptions([row("Permits", { is_active: false })]);
  assert.ok(!options.includes("Permits"));
});

test("resolveStatementCategory returns the canonical spelling or null", () => {
  const options = statementCategoryOptions([]);
  assert.equal(resolveStatementCategory("  materials & supplies ", options), "Materials & Supplies");
  assert.equal(resolveStatementCategory("BANK CHARGES & INTEREST", options), "Bank Charges & Interest");
  assert.equal(resolveStatementCategory("Yacht", options), null);
  assert.equal(resolveStatementCategory("", options), null);
  assert.equal(resolveStatementCategory(7, options), null);
});

// ---------------------------------------------------------------------------
// The bank-charges category is found by KEY, not by name
// ---------------------------------------------------------------------------

test("never created: the built-in is suggested for fees (and nothing is created for it)", () => {
  const state = resolveBankCharges([row("Permits")]);
  assert.deepEqual(state, { state: "virtual", name: "Bank Charges & Interest" });
  assert.equal(bankChargesSuggestion(state), "Bank Charges & Interest");
});

test("RENAMED: the keyed row is still found, under its new name, in the options and as the fee suggestion", () => {
  const rows = [KEYED("Bank fees")];
  assert.deepEqual(resolveBankCharges(rows), { state: "active", name: "Bank fees", keyed: true });
  assert.equal(bankChargesSuggestion(resolveBankCharges(rows)), "Bank fees");
  const options = statementCategoryOptions(rows);
  assert.ok(options.includes("Bank fees"));
  assert.ok(!options.includes("Bank charges"), "the default name must NOT be offered alongside it - that is the duplicate bug");
});

test("RENAMED, then the owner makes a NEW category called 'Bank charges': the keyed one still wins", () => {
  const rows = [KEYED("Bank fees"), row("Bank charges")];
  assert.deepEqual(resolveBankCharges(rows), { state: "active", name: "Bank fees", keyed: true });
});

test("REMOVED: respected - nothing is suggested, nothing is offered, nothing is recreated", () => {
  const rows = [KEYED("Bank fees", false)];
  const state = resolveBankCharges(rows);
  assert.deepEqual(state, { state: "removed" });
  assert.equal(bankChargesSuggestion(state), null);
  const options = statementCategoryOptions(rows);
  assert.ok(!options.includes("Bank fees"));
  assert.ok(!options.includes("Bank charges"), "a removed category must not be quietly offered under the default name");
});

test("REMOVED while still under the default name behaves the same", () => {
  assert.deepEqual(resolveBankCharges([KEYED("Bank charges", false)]), { state: "removed" });
});

test("a removed one that is then restored is back, under whatever name it has now", () => {
  const rows = [KEYED("Bank fees", true)];
  assert.equal(bankChargesSuggestion(resolveBankCharges(rows)), "Bank fees");
});

test("before migration 0055 (no keys): an existing 'Bank charges' is adopted, not duplicated", () => {
  const rows = [row("Bank charges")];
  // the stock custom row is the built-in under its old name
  assert.deepEqual(resolveBankCharges(rows), { state: "active", name: "Bank Charges & Interest", keyed: false });
  assert.equal(statementCategoryOptions(rows).filter((o) => o.toLowerCase().startsWith("bank charges")).length, 1);
});

test("before migration 0055: an inactive 'Bank charges' is also respected as removed", () => {
  assert.deepEqual(resolveBankCharges([row("Bank charges", { is_active: false })]), { state: "removed" });
});

test("the key is matched exactly; another system_key value is ignored", () => {
  const rows = [row("Bank fees", { system_key: "something_else" })];
  assert.equal(resolveBankCharges(rows).state, "virtual");
});
