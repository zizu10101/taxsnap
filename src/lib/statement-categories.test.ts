import assert from "node:assert/strict";
import test from "node:test";
import { resolveStatementCategory, statementCategoryOptions } from "./statement-categories.ts";

test("options are the built-ins, the owner's own, and Bank charges", () => {
  const options = statementCategoryOptions(["Permits"]);
  assert.ok(options.includes("Supplies"));
  assert.ok(options.includes("Permits"));
  assert.ok(options.includes("Bank charges"));
});

test("an owner's own 'bank charges' category is not duplicated", () => {
  const options = statementCategoryOptions(["bank charges"]);
  assert.equal(options.filter((o) => o.toLowerCase() === "bank charges").length, 1);
});

test("resolveStatementCategory returns the canonical spelling or null", () => {
  const options = statementCategoryOptions([]);
  assert.equal(resolveStatementCategory("  supplies ", options), "Supplies");
  assert.equal(resolveStatementCategory("BANK CHARGES", options), "Bank charges");
  assert.equal(resolveStatementCategory("Yacht", options), null);
  assert.equal(resolveStatementCategory("", options), null);
  assert.equal(resolveStatementCategory(7, options), null);
});
