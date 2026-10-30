import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CATEGORY_INFO,
  LEGACY_CATEGORY_ALIASES,
  TAX_CATEGORIES,
  canonicalCategory,
  categoryAccountCode,
  categoryDeductibleRate,
  categoryDefaultCode,
  categoryGroupKey,
  categoryItcRate,
  isBuiltInCategory,
  isMealsCategory,
  mapsToBuiltInCategory,
  sameCategory,
} from "./tax-categories.ts";
import { claimableItc, deductiblePct, itcPct } from "./tax-codes.ts";

test("the built-in list is the agreed 19 categories, in order, ending with Other", () => {
  assert.deepEqual(
    [...TAX_CATEGORIES],
    [
      "Materials & Supplies",
      "Inventory",
      "Subcontractors",
      "Tools & Equipment",
      "Capital Assets",
      "Vehicle & Fuel",
      "Travel & Accommodation",
      "Meals & Entertainment",
      "Rent & Utilities",
      "Phone & Internet",
      "Office & Admin",
      "Software & Website",
      "Advertising & Promotion",
      "Professional Fees",
      "Licenses, Permits & Training",
      "Insurance",
      "Wages & Payroll",
      "Bank Charges & Interest",
      "Other",
    ],
  );
  assert.deepEqual(Object.keys(CATEGORY_INFO), [...TAX_CATEGORIES]);
});

test("default code of every category: full = taxable, Meals = meals, Insurance / Wages / Bank charges = none, Other = no default", () => {
  const none = ["Insurance", "Wages & Payroll", "Bank Charges & Interest"];
  for (const c of TAX_CATEGORIES) {
    const expected = c === "Other" ? null : c === "Meals & Entertainment" ? "meals" : none.includes(c) ? "none" : "taxable";
    assert.equal(categoryDefaultCode(c), expected, c);
  }
});

test("old -> new: every old built-in name maps as agreed", () => {
  const expected: Record<string, string> = {
    "Job Materials": "Materials & Supplies",
    Supplies: "Materials & Supplies",
    Inventory: "Inventory",
    "Tools & Equipment": "Tools & Equipment",
    "Vehicle/Fuel": "Vehicle & Fuel",
    Gas: "Vehicle & Fuel",
    "407": "Vehicle & Fuel",
    Lease: "Rent & Utilities",
    Rent: "Rent & Utilities",
    Phone: "Phone & Internet",
    Internet: "Phone & Internet",
    "Office/Admin": "Office & Admin",
    Advertising: "Advertising & Promotion",
    Meals: "Meals & Entertainment",
    Insurance: "Insurance",
    Other: "Other",
    "Bank charges": "Bank Charges & Interest",
  };
  for (const [from, to] of Object.entries(expected)) {
    assert.equal(canonicalCategory(from), to, from);
    // case and surrounding whitespace never matter
    assert.equal(canonicalCategory(`  ${from.toUpperCase()} `), to, `${from} (upper case, padded)`);
  }
  // every alias resolves to a real built-in
  for (const target of Object.values(LEGACY_CATEGORY_ALIASES)) assert.ok(isBuiltInCategory(target), target);
});

test("a new built-in name maps to itself, in its own spelling", () => {
  for (const c of TAX_CATEGORIES) {
    assert.equal(canonicalCategory(c), c);
    assert.equal(canonicalCategory(c.toLowerCase()), c);
  }
});

test("an owner's custom categories are untouched (only trimmed), and empty means Other", () => {
  for (const c of ["Pet Care", "Permits", "Wages", "Yacht Upkeep", "Licences", "bank fees"]) {
    assert.equal(canonicalCategory(c), c);
    assert.equal(canonicalCategory(`  ${c}  `), c);
    assert.equal(isBuiltInCategory(c), false);
    assert.equal(mapsToBuiltInCategory(c), false);
  }
  assert.equal(canonicalCategory(""), "Other");
  assert.equal(canonicalCategory("   "), "Other");
  assert.equal(canonicalCategory(null), "Other");
  assert.equal(canonicalCategory(undefined), "Other");
});

test("old and new spellings share one group key, so a report can never split them", () => {
  assert.equal(categoryGroupKey("Gas"), categoryGroupKey("Vehicle & Fuel"));
  assert.equal(categoryGroupKey("407"), categoryGroupKey("vehicle/fuel"));
  assert.equal(categoryGroupKey("Bank charges"), categoryGroupKey("Bank Charges & Interest"));
  assert.equal(sameCategory("Job Materials", "Materials & Supplies"), true);
  assert.equal(sameCategory("Supplies", "Inventory"), false);
  assert.equal(sameCategory("Pet Care", "pet care"), true);
  assert.equal(sameCategory("Pet Care", "Other"), false);
});

test("ITC rate with no tax code of its own: Meals 50%, Insurance / Wages / Bank charges 0%, everything else 100%", () => {
  assert.equal(categoryItcRate("Meals & Entertainment"), 0.5);
  assert.equal(categoryItcRate("Meals"), 0.5, "the old name behaves like the new one");
  for (const c of ["Insurance", "Wages & Payroll", "Bank Charges & Interest", "Bank charges"]) {
    assert.equal(categoryItcRate(c), 0, c);
  }
  for (const c of TAX_CATEGORIES.filter((x) => !["Meals & Entertainment", "Insurance", "Wages & Payroll", "Bank Charges & Interest"].includes(x))) {
    assert.equal(categoryItcRate(c), 1, c);
  }
  assert.equal(categoryItcRate("Pet Care"), 1, "a custom category is 100%");
  assert.equal(categoryItcRate(null), 1, "Other keeps today's behaviour");
});

test("no-ITC categories are still fully deductible; only Meals is 50% deductible", () => {
  for (const c of ["Insurance", "Wages & Payroll", "Bank Charges & Interest"]) assert.equal(categoryDeductibleRate(c), 1, c);
  assert.equal(categoryDeductibleRate("Meals & Entertainment"), 0.5);
  assert.equal(categoryDeductibleRate("Meals"), 0.5);
  assert.equal(categoryDeductibleRate("Pet Care"), 1);
});

test("a scanned or typed receipt (no tax code) is read with its category's rate", () => {
  const row = (tax_category: string) => ({ tax_category, tax_amount: 13, itc_pct: null, deductible_pct: null });
  assert.equal(claimableItc(row("Insurance")), 0);
  assert.equal(claimableItc(row("Wages & Payroll")), 0);
  assert.equal(claimableItc(row("Bank charges")), 0, "the old custom 'Bank charges' name");
  assert.equal(claimableItc(row("Meals")), 6.5);
  assert.equal(claimableItc(row("Meals & Entertainment")), 6.5);
  assert.equal(claimableItc(row("Job Materials")), 13);
  assert.equal(claimableItc(row("Other")), 13);
  assert.equal(claimableItc(row("Pet Care")), 13);
  assert.equal(deductiblePct(row("Insurance")), 1);
  assert.equal(itcPct(row("Insurance")), 0);
});

test("a row's own tax code still beats its category", () => {
  // a statement expense coded taxable in the no-ITC category Insurance keeps its code
  assert.equal(itcPct({ tax_category: "Insurance", itc_pct: 1, deductible_pct: 1 }), 1);
  assert.equal(itcPct({ tax_category: "Materials & Supplies", itc_pct: 0, deductible_pct: 1 }), 0);
});

test("hidden account codes: as given, none for Inventory and Other", () => {
  const expected: Record<string, string | null> = {
    "Materials & Supplies": "5400",
    Subcontractors: "5200",
    "Tools & Equipment": "5300",
    "Capital Assets": "1530",
    "Vehicle & Fuel": "6353",
    "Travel & Accommodation": "6350",
    "Meals & Entertainment": "6300",
    "Rent & Utilities": "6700",
    "Phone & Internet": "6800",
    "Office & Admin": "6600",
    "Software & Website": "6810",
    "Advertising & Promotion": "6500",
    "Professional Fees": "6900",
    "Licenses, Permits & Training": "5100",
    Insurance: "6910",
    "Wages & Payroll": "5500",
    "Bank Charges & Interest": "6930",
    Inventory: null,
    Other: null,
  };
  for (const c of TAX_CATEGORIES) assert.equal(categoryAccountCode(c), expected[c], c);
  assert.equal(categoryAccountCode("Gas"), "6353", "found through the old name too");
  assert.equal(categoryAccountCode("Pet Care"), null);
});

test("isMealsCategory covers the old and new Meals names only", () => {
  assert.equal(isMealsCategory("Meals"), true);
  assert.equal(isMealsCategory("meals & entertainment"), true);
  assert.equal(isMealsCategory("Travel & Accommodation"), false);
  assert.equal(isMealsCategory("Pet Care"), false);
});
