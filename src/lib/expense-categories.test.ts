import { test } from "node:test";
import assert from "node:assert/strict";
import { isDefaultCategory, mergeCategories } from "./expense-categories.ts";
import { TAX_CATEGORIES } from "./tax-categories.ts";

test("custom categories are added after the built-ins, which are left untouched", () => {
  const merged = mergeCategories(["Zebra Rental", "Permits"]);
  assert.deepEqual(merged.slice(0, TAX_CATEGORIES.length), [...TAX_CATEGORIES]);
  assert.deepEqual(merged.slice(TAX_CATEGORIES.length), ["Permits", "Zebra Rental"]);
});

test("a custom name colliding with a built-in or another custom one is dropped, case-insensitively", () => {
  const merged = mergeCategories(["meals", "Permits", "permits "]);
  assert.equal(merged.length, TAX_CATEGORIES.length + 1);
  assert.equal(merged[merged.length - 1], "Permits");
});

test("isDefaultCategory ignores case and surrounding whitespace", () => {
  assert.equal(isDefaultCategory("  meals "), true);
  assert.equal(isDefaultCategory("Zebra Rental"), false);
});

test("an old built-in name and the stock custom 'Bank charges' count as built-in, so they are neither offered nor created twice", () => {
  assert.equal(isDefaultCategory("Gas"), true);
  assert.equal(isDefaultCategory(" job materials "), true);
  assert.equal(isDefaultCategory("Bank charges"), true);
  const merged = mergeCategories(["Bank charges", "Permits"]);
  assert.equal(merged.length, TAX_CATEGORIES.length + 1);
  assert.equal(merged.includes("Bank charges"), false);
});
