import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  guessMapping,
  guessMappingWith,
  parseDelimited,
  rowsWithExtraValues,
} from "./client-import.ts";
import {
  EXPENSE_IMPORT_BATCH,
  EXPENSE_IMPORT_MAX_BYTES,
  EXPENSE_IMPORT_MAX_ROWS,
  allMonthNameDates,
  analyzeDateFormat,
  DATE_SET_AT_IMPORT_NOTE,
  TOTAL_REASONS,
  buildImportRows,
  dateFormatQuestion,
  decideRow,
  detectTotalRows,
  guessExpenseMapping,
  headingsKey,
  isTotalLabel,
  mappingProblems,
  parseAmount,
  parseDate,
  parseSavedMapping,
  planExpenseImport,
  planTotals,
  resolveImportCategory,
  type ExistingExpense,
  type ExpenseImportRow,
  type ExpenseImportTarget,
  type PlanContext,
} from "./expense-import.ts";
import { handleExpenseImport, handleExpenseImportUndo } from "./expense-import-server.ts";
import { buildCategoryDefaults } from "./tax-codes.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// ---- reading the file: delimiters, BOM, quotes (the client import's own parser, reused) ----------

test("the expense import reads comma, semicolon and tab files, with or without a BOM", () => {
  for (const [delimiter, sep] of [[",", ","], [";", ";"], ["\t", "\t"]] as const) {
    for (const bom of ["", "﻿"]) {
      const t = parseDelimited(`${bom}Date${sep}Supplier${sep}Total\n2026-03-14${sep}Acme${sep}113.00\n`);
      assert.equal(t.delimiter, delimiter);
      assert.deepEqual(t.headers, ["Date", "Supplier", "Total"], "a BOM never ends up in the first heading");
      assert.deepEqual(t.rows[0].cells, ["2026-03-14", "Acme", "113.00"]);
    }
  }
});

test("quoted fields: commas, escaped quotes and line breaks inside a cell stay in that cell", () => {
  const t = parseDelimited('Date,Supplier,Description,Total\n2026-03-14,"Acme, Inc.","12"" pipe\nand fittings","1,234.50"\n');
  assert.deepEqual(t.rows[0].cells, ["2026-03-14", "Acme, Inc.", '12" pipe\nand fittings', "1,234.50"]);
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].row, 2);
});

// ---- the mapping ---------------------------------------------------------------------------------

test("headings are guessed exactly, one column per field", () => {
  assert.deepEqual(
    guessExpenseMapping(["Invoice Date", "Vendor", "Invoice #", "Subtotal", "HST", "Total", "Category", "Memo", "Whatever"]),
    ["date", "supplier", "invoice_number", "subtotal", "tax", "total", "category", "description", "ignore"],
  );
  // a second column for a field already taken is ignored; unknown headings are ignored
  assert.deepEqual(guessExpenseMapping(["Total", "Amount", "Date"]), ["total", "ignore", "date"]);
});

test("Continue needs a date, and a total or a subtotal plus a tax column", () => {
  const p = (m: ExpenseImportTarget[]) => mappingProblems(m);
  assert.deepEqual(p(["date", "total"]), []);
  assert.deepEqual(p(["date", "subtotal", "tax"]), []);
  assert.equal(p(["total"]).length, 1, "no date");
  assert.equal(p(["date", "subtotal"]).length, 1, "a subtotal alone is not enough");
  assert.equal(p(["date", "tax"]).length, 1, "a tax alone is not enough");
  assert.equal(p(["supplier"]).length, 2);
});

test("the remembered mapping is keyed by the headings and rejected when it no longer fits", () => {
  const a = headingsKey(["Date", "Vendor", "Total"]);
  assert.equal(headingsKey(["date", "VENDOR", "total "]), a, "case and punctuation do not matter");
  assert.notEqual(headingsKey(["Date", "Total", "Vendor"]), a, "order matters: the mapping is per column");
  assert.notEqual(headingsKey(["Date", "Vendor", "Total", "Notes"]), a);
  const good = JSON.stringify(["date", "supplier", "total"]);
  assert.deepEqual(parseSavedMapping(good, 3), ["date", "supplier", "total"]);
  assert.equal(parseSavedMapping(good, 4), null, "a different number of columns");
  assert.equal(parseSavedMapping(JSON.stringify(["date", "date", "total"]), 3), null, "a field claimed twice");
  assert.equal(parseSavedMapping(JSON.stringify(["date", "nonsense", "total"]), 3), null);
  assert.equal(parseSavedMapping("{not json", 3), null);
  assert.equal(parseSavedMapping(null, 3), null);
});

test("the dialog wraps every localStorage access in try/catch", () => {
  const src = read("../components/dashboard/import-expenses-dialog.tsx");
  for (const call of ["getItem", "setItem"]) {
    const at = src.indexOf(`localStorage.${call}`);
    assert.ok(at > 0, call);
    assert.match(src.slice(Math.max(0, at - 80), at), /try \{/, `${call} is inside a try`);
  }
});

// ---- dates ---------------------------------------------------------------------------------------

test("ISO, year-first and ISO-with-time dates need no format choice", () => {
  assert.equal(parseDate("2026-03-14", null), "2026-03-14");
  assert.equal(parseDate("2026/3/4", null), "2026-03-04");
  assert.equal(parseDate("2026.03.04", null), "2026-03-04");
  assert.equal(parseDate("2026-03-14T10:20:00Z", null), "2026-03-14");
  assert.deepEqual(analyzeDateFormat(["2026-03-14", "2026/03/15"]), { needsChoice: false, detected: null });
});

test("slash dates: day-first and month-first give different dates, and without a choice an ambiguous one is NOT read", () => {
  assert.equal(parseDate("03/04/2026", "dmy"), "2026-04-03");
  assert.equal(parseDate("03/04/2026", "mdy"), "2026-03-04");
  assert.equal(parseDate("03/04/2026", null), null, "never guessed silently");
  assert.equal(parseDate("14/03/2026", null), "2026-03-14", "a first part over 12 can only be a day");
  assert.equal(parseDate("03/14/2026", null), "2026-03-14", "a second part over 12 can only be a day");
  assert.equal(parseDate("14/03/26", "dmy"), "2026-03-14", "two-digit years");
  assert.equal(parseDate("14-03-2026", "dmy"), "2026-03-14", "dashes and dots too");
  assert.equal(parseDate("14/03/2026", "mdy"), null, "a date that does not fit the chosen order is unreadable");
});

test("unreadable dates are null: bad calendar days, other formats, text, out-of-range years", () => {
  for (const v of ["31/02/2026", "2026-02-30", "2026-13-01", "Smarch 14, 2026", "not a date", "", "99/99/9999", "1999-12-31"]) {
    assert.equal(parseDate(v, "dmy"), null, v);
  }
});

test("the whole file decides whether the person must choose", () => {
  // nothing proves it: choose
  assert.deepEqual(analyzeDateFormat(["03/04/2026", "05/06/2026"]), { needsChoice: true, detected: null });
  // one date proves day-first, one proves month-first, one proves nothing
  assert.deepEqual(analyzeDateFormat(["14/03/2026", "03/04/2026"]), { needsChoice: false, detected: "dmy" });
  assert.deepEqual(analyzeDateFormat(["03/14/2026", "03/04/2026"]), { needsChoice: false, detected: "mdy" });
  // contradictory: choose
  assert.deepEqual(analyzeDateFormat(["14/03/2026", "03/14/2026"]), { needsChoice: true, detected: null });
  // both orders give the same date for every row: nothing to ask
  assert.equal(analyzeDateFormat(["05/05/2026", "11/11/2026"]).needsChoice, false);
  // mixed with ISO rows: only the slash rows count
  assert.equal(analyzeDateFormat(["2026-03-14", "03/04/2026"]).needsChoice, true);
});

test("month-name dates read the same under every order setting, in every written form", () => {
  const forms = [
    "Jul 2, 2026", "Jul 2 2026", "July 2, 2026", "JULY 2 2026", "jul 02, 2026",
    "2 Jul 2026", "2 July 2026", "2 Jul, 2026", "02 JUL 2026", "2026-Jul-2", "2026-July-02", "  Jul   2,  2026  ",
  ];
  for (const form of forms) {
    for (const order of [null, "dmy", "mdy"] as const) assert.equal(parseDate(form, order), "2026-07-02", `${form} / ${order}`);
  }
  assert.equal(parseDate("Sep 30, 2026", "dmy"), "2026-09-30");
  assert.equal(parseDate("May 5, 2026", "mdy"), "2026-05-05");
});

test("month-name dates are validated against the real calendar and the month word", () => {
  for (const v of ["Feb 30, 2026", "30 Feb 2026", "2026-Feb-30", "Feb 29, 2026", "Jul 32, 2026", "Jul 0, 2026", "Sept 2, 2026", "Ju 2, 2026", "Foo 2, 2026", "Jul 2, 1999"]) {
    assert.equal(parseDate(v, null), null, v);
  }
  assert.equal(parseDate("Feb 29, 2028", null), "2028-02-29", "a real leap day");
});

test("a column that is all month-name dates needs no format question", () => {
  assert.equal(allMonthNameDates(["Jul 2, 2026", "", "2 Aug 2026"]), true);
  assert.equal(allMonthNameDates(["Jul 2, 2026", "03/04/2026"]), false);
  assert.equal(allMonthNameDates(["", " "]), false);
  const t = table("Created Date,Total\n\"Jul 2, 2026\",10.00\n\"Aug 3, 2026\",20.00\n");
  assert.deepEqual(dateFormatQuestion(t, ["date", "total"]), { needsChoice: false, detected: null });
});

// A supplier sheet like the Nike one: 3 blank lines above the header, "Mon D, YYYY" dates, "$1,410.25" amounts,
// and a grand-total row at the end.
const NIKE_LINES = [
  ["Jul 2, 2026", "INV-1001", "$1,410.25"], ["Jul 3, 2026", "INV-1002", "$288.00"], ["Jul 7, 2026", "INV-1003", "$2,046.10"],
  ["Jul 9, 2026", "INV-1004", "$95.40"], ["Jul 14, 2026", "INV-1005", "$1,000.00"], ["Jul 15, 2026", "INV-1006", "$742.31"],
  ["Jul 21, 2026", "INV-1007", "$3,310.75"], ["Jul 22, 2026", "INV-1008", "$12.99"], ["Jul 28, 2026", "INV-1009", "$560.00"],
  ["Jul 30, 2026", "INV-1010", "$1,875.50"], ["Aug 4, 2026", "INV-1011", "$420.20"], ["Aug 6, 2026", "INV-1012", "$99.99"],
  ["Aug 11, 2026", "INV-1013", "$2,500.00"], ["Aug 13, 2026", "INV-1014", "$38.15"], ["Aug 18, 2026", "INV-1015", "$1,120.80"],
  ["Aug 20, 2026", "INV-1016", "$640.00"], ["Aug 25, 2026", "INV-1017", "$77.77"], ["Aug 27, 2026", "INV-1018", "$1,305.05"],
  ["Sep 1, 2026", "INV-1019", "$810.60"],
];
const NIKE_TOTAL = Math.round(NIKE_LINES.reduce((s, l) => s + Number(l[2].replace(/[$,]/g, "")), 0) * 100) / 100;
const NIKE_CSV =
  ",,\n,,\n,,\n" +
  "Created Date,Reference Number,Open to Pay (CAD)\n" +
  NIKE_LINES.map(([d, ref, amt]) => `"${d}",${ref},"${amt}"`).join("\n") +
  `\n,,"$${NIKE_TOTAL.toLocaleString("en-US", { minimumFractionDigits: 2 })}"\n`;

test("supplier sheet with month-name dates: headings map, 19 rows build, trailing total row is flagged", () => {
  const t = parseDelimited(NIKE_CSV);
  assert.deepEqual(t.headers, ["Created Date", "Reference Number", "Open to Pay (CAD)"], "blank lines above the header are skipped");
  assert.equal(t.rows.length, 20);
  const guessed = guessExpenseMapping(t.headers);
  assert.equal(guessed[0], "date", "Created Date");
  assert.equal(guessed[1], "invoice_number", "Reference Number");
  const mapping: ExpenseImportTarget[] = ["date", "invoice_number", "total"];

  assert.deepEqual(dateFormatQuestion(t, mapping), { needsChoice: false, detected: null });
  for (const order of [null, "dmy", "mdy"] as const) {
    const { rows, problems } = buildImportRows(t, mapping, { supplierName: "Nike", dateOrder: order });
    assert.equal(problems.length, 0, `${order}`);
    assert.equal(rows.length, 20);
    assert.deepEqual([rows[0].date, rows[0].invoice_number, rows[0].total], ["2026-07-02", "INV-1001", 1410.25]);
    assert.equal(rows[18].date, "2026-09-01");
    assert.equal(rows[19].date, "", "the total row has no date");

    const flags = detectTotalRows(rows);
    assert.equal(flags.slice(0, 19).filter((f) => f !== null).length, 0, "no real invoice is flagged");
    assert.notEqual(flags[19], null, "the total row is flagged");
    const planned = plan(rows.map((r) => ({ ...r, supplier_defaulted: true })), ctx());
    assert.equal(planned[19].status, "total");
    assert.equal(decideRow(planned[19], {}), "skip", "the total row is left out");
    const imported = planned.filter((p, i) => decideRow(p, rows[i]) === "import");
    assert.equal(imported.length, 19);
    assert.equal(Math.round(imported.reduce((s, p) => s + p.expense!.total_amount, 0) * 100) / 100, NIKE_TOTAL);
  }
});

// ---- amounts -------------------------------------------------------------------------------------

test("amounts: $, spaces and thousands commas are stripped", () => {
  const ok = (raw: string, value: number) => assert.deepEqual(parseAmount(raw), { state: "ok", value }, raw);
  ok("$1,234.50", 1234.5);
  ok(" 12.5 ", 12.5);
  ok("$ 7", 7);
  ok("1,234,567.89", 1234567.89);
  ok("1234.5", 1234.5);
  ok(".5", 0.5);
  ok("0.00", 0);
});

test("amounts: parentheses, a leading minus and a trailing minus all mean negative", () => {
  const ok = (raw: string, value: number) => assert.deepEqual(parseAmount(raw), { state: "ok", value }, raw);
  ok("(45.00)", -45);
  ok("($1,045.00)", -1045);
  ok("45.00-", -45);
  ok("-45", -45);
  ok("-$45.00", -45);
  ok("−45.00", -45);
  const zero = parseAmount("-0");
  assert.ok(zero.state === "ok" && Object.is(zero.value, 0), "no negative zero");
});

test("amounts: blank is blank; anything unreadable is bad, including a decimal comma that would be read 100x too big", () => {
  assert.deepEqual(parseAmount(""), { state: "blank" });
  assert.deepEqual(parseAmount("  "), { state: "blank" });
  for (const v of ["abc", "12,50", "1,23,456", "1.2.3", "12 CAD", "--5", "(", "1e5", "99999999999"]) {
    assert.deepEqual(parseAmount(v), { state: "bad" }, v);
  }
});

// ---- building rows from a table -----------------------------------------------------------------

const table = (text: string) => parseDelimited(text);

test("subtotal + tax columns, and a blank tax cell means no tax", () => {
  const t = table("Date,Vendor,Subtotal,HST\n2026-03-14,Acme,100.00,13.00\n2026-03-15,Acme,50.00,\n");
  const { rows, problems } = buildImportRows(t, ["date", "supplier", "subtotal", "tax"], { supplierName: "", dateOrder: null });
  assert.equal(problems.length, 0);
  assert.deepEqual(rows.map((r) => [r.subtotal, r.tax, r.total]), [[100, 13, null], [50, 0, null]]);
});

test("with no tax column, tax is null (to be estimated); with no supplier column, the one name is used", () => {
  const t = table("Date,Amount\n2026-03-14,113.00\n");
  const { rows } = buildImportRows(t, ["date", "total"], { supplierName: "  Acme Paint  ", dateOrder: null });
  assert.equal(rows[0].tax, null);
  assert.equal(rows[0].supplier, "Acme Paint");
  assert.equal(rows[0].total, 113);
});

test("a blank supplier cell falls back to the one supplier name", () => {
  const t = table("Date,Vendor,Total\n2026-03-14,,10.00\n2026-03-14,Rona,10.00\n");
  const { rows } = buildImportRows(t, ["date", "supplier", "total"], { supplierName: "Acme", dateOrder: null });
  assert.deepEqual(rows.map((r) => r.supplier), ["Acme", "Rona"]);
});

test("a row with an unreadable date or amount is a problem (never sent), and the other rows carry on", () => {
  const t = table('Date,Total\n2026-03-14,10.00\nsoon,10.00\n2026-03-16,twelve\n,5.00\n2026-03-18,"12,50"\n');
  const { rows, problems } = buildImportRows(t, ["date", "total"], { supplierName: "X", dateOrder: null });
  // row 5 has a blank date: it is sent (the server decides: picker, error, or a total row)
  assert.deepEqual(rows.map((r) => r.row), [2, 5]);
  assert.deepEqual(problems.map((p) => [p.row, p.reason.split(" ")[0]]), [[3, "Unreadable"], [4, "Unreadable"], [6, "Unreadable"]]);
});

test("an unquoted decimal comma shifts the cells: the row is an error, never silently read as 12", () => {
  const text = 'Date,Total\n2026-03-14,10.00\n2026-03-18,12,50\n2026-03-19,"12,50"\n';
  const t = table(text);
  assert.deepEqual([...rowsWithExtraValues(text)], [3], "only the row with extra values");
  const { rows, problems } = buildImportRows(t, ["date", "total"], {
    supplierName: "X",
    dateOrder: null,
    overflowRows: rowsWithExtraValues(text),
  });
  assert.deepEqual(rows.map((r) => r.row), [2]);
  assert.deepEqual(problems.map((p) => p.row), [3, 4], 'row 4 is the quoted "12,50", an unreadable amount');
  assert.match(problems[0].reason, /More values/);
  // trailing empty cells (a trailing comma) are not extra values
  assert.equal(rowsWithExtraValues("Date,Total\n2026-03-14,10.00,\n").size, 0);
});

test("a day-first or month-first choice is applied to every slash date", () => {
  const t = table("Date,Total\n03/04/2026,10.00\n05/06/2026,10.00\n");
  assert.deepEqual(buildImportRows(t, ["date", "total"], { supplierName: "X", dateOrder: "dmy" }).rows.map((r) => r.date), ["2026-04-03", "2026-06-05"]);
  assert.deepEqual(buildImportRows(t, ["date", "total"], { supplierName: "X", dateOrder: "mdy" }).rows.map((r) => r.date), ["2026-03-04", "2026-05-06"]);
  // with no choice at all, the ambiguous rows are reported, never guessed
  assert.equal(buildImportRows(t, ["date", "total"], { supplierName: "X", dateOrder: null }).problems.length, 2);
});

// ---- the plan: totals, tax, categories ------------------------------------------------------------

const defaults = buildCategoryDefaults({ bankChargesName: null });
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  defaultCategory: "Materials & Supplies",
  customCategories: [],
  existing: [],
  defaults,
  ...over,
});
const row = (over: Partial<ExpenseImportRow> = {}): ExpenseImportRow => ({
  row: 2,
  date: "2026-03-14",
  supplier: "Acme",
  invoice_number: "",
  category: "",
  description: "",
  subtotal: null,
  tax: null,
  total: 113,
  ...over,
});
const plan = (rows: ExpenseImportRow[], c = ctx()) => planExpenseImport(rows, c);
const one = (r: Partial<ExpenseImportRow>, c = ctx()) => plan([row(r)], c)[0];

test("subtotal + tax gives the total", () => {
  const p = one({ subtotal: 100, tax: 13, total: null });
  assert.equal(p.status, "ready");
  assert.deepEqual([p.expense!.total_amount, p.expense!.tax_amount, p.expense!.tax_estimated], [113, 13, false]);
});

test("a given total is kept as it is, and a subtotal with it makes the tax exact (not estimated)", () => {
  const p = one({ subtotal: 100, total: 113.5 });
  assert.deepEqual([p.expense!.total_amount, p.expense!.tax_amount, p.expense!.tax_estimated], [113.5, 13.5, false]);
});

test("a tax column is used as entered, never re-estimated", () => {
  const p = one({ total: 113, tax: 5 });
  assert.deepEqual([p.expense!.tax_amount, p.expense!.tax_estimated], [5, false]);
  assert.equal(one({ total: 113, tax: 0 }).expense!.tax_amount, 0);
});

test("no tax column: the category's default code is backed out of the total (13/113) and the row is marked estimated", () => {
  const p = one({ total: 113 });
  assert.deepEqual([p.expense!.tax_amount, p.expense!.tax_estimated, p.status], [13, true, "ready"]);
  assert.equal(one({ total: 56.5 }).expense!.tax_amount, 6.5);
  assert.equal(one({ total: 100 }).expense!.tax_amount, 11.5, "100 x 13/113 = 11.50, not 13.00 added on top");
  assert.ok(p.expense!.items.some((i) => /estimated/i.test(i.name)), "the estimate is noted on the expense itself");
});

test("a Meals row has the tax backed out in full (the claim share is applied when read, as for any expense)", () => {
  const p = one({ total: 113, category: "Meals & Entertainment" });
  assert.deepEqual([p.expense!.tax_category, p.expense!.tax_amount, p.expense!.tax_estimated], ["Meals & Entertainment", 13, true]);
});

test("a category with no ITC gets no tax and is not marked estimated", () => {
  for (const category of ["Insurance", "Wages & Payroll", "Bank Charges & Interest"]) {
    const p = one({ total: 113, category });
    assert.deepEqual([p.expense!.tax_amount, p.expense!.tax_estimated, p.status], [0, false, "ready"], category);
  }
});

test("a category with no default code (Other, or the owner's own) gets tax 0 and a warning", () => {
  const other = one({ total: 113, category: "Other" });
  assert.deepEqual([other.expense!.tax_amount, other.status], [0, "warning"]);
  const custom = one({ total: 113, category: "Pet Care" }, ctx({ customCategories: ["Pet Care"] }));
  assert.deepEqual([custom.expense!.tax_category, custom.expense!.tax_amount, custom.status], ["Pet Care", 0, "warning"]);
});

test("category: blank uses the default; old names and built-ins resolve; the owner's own match any case; unknown becomes Other with a warning", () => {
  assert.equal(one({ category: "" }).expense!.tax_category, "Materials & Supplies");
  assert.equal(one({ category: "  " }, ctx({ defaultCategory: "Insurance" })).expense!.tax_category, "Insurance");
  assert.equal(one({ category: "Job Materials" }).expense!.tax_category, "Materials & Supplies");
  assert.equal(one({ category: "gas" }).expense!.tax_category, "Vehicle & Fuel");
  assert.equal(one({ category: "bank charges" }).expense!.tax_category, "Bank Charges & Interest");
  assert.equal(one({ category: "pet care" }, ctx({ customCategories: ["Pet Care"] })).expense!.tax_category, "Pet Care");
  const unknown = one({ category: "Yacht upkeep" });
  assert.equal(unknown.expense!.tax_category, "Other");
  assert.equal(unknown.status, "warning");
  assert.match(unknown.messages.join(" "), /Other/);
  assert.doesNotMatch(unknown.messages.join(" "), /Yacht/, "a row's own text is never echoed in a message");
  assert.deepEqual(resolveImportCategory("", "Insurance", []), { category: "Insurance", unknown: false });
});

test("rows that cannot import are errors with a fixed reason: supplier, date, amounts", () => {
  const reasons = (r: Partial<ExpenseImportRow>) => one(r);
  assert.equal(reasons({ supplier: "   " }).status, "error");
  assert.equal(reasons({ date: "" }).status, "error");
  assert.equal(reasons({ date: "14/03/2026" }).status, "error", "only ISO dates reach the planner");
  assert.equal(reasons({ date: "2026-02-30" }).status, "error");
  assert.equal(reasons({ total: null }).status, "error", "no total, no subtotal and tax");
  assert.equal(reasons({ total: null, subtotal: 100 }).status, "error", "a subtotal alone");
  assert.equal(reasons({ total: 0 }).status, "error", "zero");
  assert.equal(reasons({ total: 113, tax: 200 }).status, "error", "tax more than the total");
  assert.equal(reasons({ total: 113, subtotal: 120 }).status, "error", "subtotal more than the total");
  assert.equal(reasons({ total: 1e12 }).status, "error", "absurd amount");
  for (const r of [reasons({ supplier: "" }), reasons({ total: 0 })]) assert.equal(r.expense, null);
});

test("negative amounts are credit notes: stored as negative expenses, tax negative too", () => {
  const p = one({ total: -113 });
  assert.deepEqual([p.status, p.expense!.credit, p.expense!.total_amount, p.expense!.tax_amount], ["ready", true, -113, -13]);
  // a tax figure printed positive on a credit is read as a credit's tax
  assert.equal(one({ total: -113, tax: 13 }).expense!.tax_amount, -13);
  assert.equal(one({ subtotal: -100, tax: -13, total: null }).expense!.total_amount, -113);
  assert.equal(one({ total: -113, subtotal: -100 }).expense!.tax_amount, -13);
});

test("supplier, description and invoice number are cleaned and capped", () => {
  const p = one({ supplier: "  Acme\u0000  Paint \n Co ", description: "  12\" pipe  ", invoice_number: " INV\u0007-1 " });
  assert.equal(p.expense!.merchant_name, "Acme Paint Co");
  assert.equal(p.expense!.invoice_number, "INV-1");
  assert.deepEqual(p.expense!.items[0], { name: '12" pipe', amount: 113 });
  const long = one({ invoice_number: "A".repeat(60), supplier: "S".repeat(300) });
  assert.equal(long.expense!.invoice_number!.length, 40);
  assert.equal(long.expense!.merchant_name.length, 200);
  assert.match(long.messages.join(" "), /shortened/);
});

// ---- duplicates ----------------------------------------------------------------------------------

const existing = (over: Partial<ExistingExpense> = {}): ExistingExpense => ({
  merchant_name: "Home Depot #4521",
  invoice_number: "INV-0042",
  transaction_date: "2026-02-01",
  total_amount: 80,
  ...over,
});

test("same invoice number and supplier as an existing expense: a duplicate, however it is spelled; other supplier or number is not", () => {
  const c = ctx({ existing: [existing()] });
  for (const invoice_number of ["INV-0042", "inv0042", " Inv 0042 ", "INV.0042"]) {
    const p = one({ supplier: "HOME DEPOT", invoice_number }, c);
    assert.equal(p.status, "duplicate", invoice_number);
    assert.match(p.messages[0], /already saved/);
  }
  assert.equal(one({ supplier: "Rona", invoice_number: "INV-0042" }, c).status, "ready", "same number, other supplier");
  assert.equal(one({ supplier: "Home Depot", invoice_number: "INV-0043" }, c).status, "ready", "other number");
});

test("the same invoice twice in the same file: the first is kept, the later one is the duplicate", () => {
  const p = plan([
    row({ row: 2, invoice_number: "A-1" }),
    row({ row: 3, invoice_number: "a 1" }),
    row({ row: 4, invoice_number: "A-1", supplier: "Other Co" }),
    row({ row: 5, invoice_number: "A-1" }),
  ]);
  assert.deepEqual(p.map((x) => x.status), ["ready", "duplicate", "ready", "duplicate"]);
  assert.match(p[1].messages[0], /row 2/);
  assert.match(p[3].messages[0], /row 2/, "always points at the first one");
});

test("no invoice number: same supplier + date + total only WARNS, against saved expenses and earlier rows", () => {
  const saved = ctx({ existing: [existing({ merchant_name: "Acme", invoice_number: null, transaction_date: "2026-03-14", total_amount: 113 })] });
  const p = one({ total: 113 }, saved);
  assert.equal(p.status, "warning");
  assert.match(p.messages.join(" "), /already saved/);
  assert.equal(one({ total: 114 }, saved).status, "ready", "another total");
  assert.equal(one({ date: "2026-03-15" }, saved).status, "ready", "another date");
  const inFile = plan([row({ row: 2 }), row({ row: 3 })]);
  assert.deepEqual(inFile.map((x) => x.status), ["ready", "warning"]);
  assert.match(inFile[1].messages[0], /row 2/);
});

test("a row WITH an invoice number is not warned by the supplier + date + total rule", () => {
  const saved = ctx({ existing: [existing({ merchant_name: "Acme", invoice_number: "OLD-1", transaction_date: "2026-03-14", total_amount: 113 })] });
  assert.equal(one({ invoice_number: "NEW-9" }, saved).status, "ready");
});

test("an error row is never a duplicate of anything, and does not make later rows duplicates", () => {
  const p = plan([row({ row: 2, invoice_number: "A-1", total: 0 }), row({ row: 3, invoice_number: "A-1" })]);
  assert.deepEqual(p.map((x) => x.status), ["error", "ready"]);
});

test("decisions: duplicates are skipped unless 'Import anyway'; unticked rows are skipped; errors never save", () => {
  const [ready, dup, err] = plan([row({ row: 2, invoice_number: "A" }), row({ row: 3, invoice_number: "A" }), row({ row: 4, total: 0 })]);
  assert.equal(decideRow(ready, {}), "import");
  assert.equal(decideRow(ready, { skip: true }), "skip");
  assert.equal(decideRow(dup, {}), "skip");
  assert.equal(decideRow(dup, { import_anyway: true }), "import");
  assert.equal(decideRow(dup, { import_anyway: true, skip: true }), "skip");
  assert.equal(decideRow(err, { import_anyway: true }), "error");
});

test("the preview totals count only what would be saved", () => {
  const planned = plan([
    row({ row: 2, total: 113 }),
    row({ row: 3, total: 226, invoice_number: "B" }),
    row({ row: 4, total: 226, invoice_number: "B" }),
    row({ row: 5, total: 0 }),
  ]);
  const items = (inputs: Partial<ExpenseImportRow>[]) => planned.map((p, i) => ({ planned: p, input: inputs[i] ?? {} }));
  assert.deepEqual(planTotals(items([])), { rows: 2, total: 339, tax: 39 });
  assert.deepEqual(planTotals(items([{ skip: true }])), { rows: 1, total: 226, tax: 26 });
  assert.deepEqual(planTotals(items([{}, {}, { import_anyway: true }])), { rows: 3, total: 565, tax: 65 });
});

// ---- the server: re-validation, batches, the summary ---------------------------------------------

type Row = Record<string, unknown>;
function makeDb(
  opts: { receipts?: Row[]; categories?: Row[]; rejectRow?: (r: Row) => boolean; missingColumn?: string } = {},
) {
  const receipts: Row[] = (opts.receipts ?? []).map((r, i) => ({ id: `seed-${i}`, ...r }));
  const log = { inserts: [] as number[], tables: [] as string[] };
  let counter = 0;
  const db = {
    from(table: string) {
      log.tables.push(table);
      let op: "select" | "insert" | "delete" = "select";
      const filters: ((r: Row) => boolean)[] = [];
      let values: Row[] = [];
      let range: [number, number] | null = null;
      let single = false;
      const rows = () => (table === "expense_categories" ? (opts.categories ?? []) : receipts);
      const b = {
        select: () => b,
        insert: (v: Row | Row[]) => ((op = "insert"), (values = Array.isArray(v) ? v : [v]), b),
        delete: () => ((op = "delete"), b),
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        in: (c: string, v: unknown[]) => (filters.push((r) => v.includes(r[c])), b),
        is: (c: string, v: null) => (filters.push((r) => (r[c] ?? null) === v), b),
        not: (c: string) => (filters.push((r) => r[c] != null), b),
        gte: (c: string, v: string) => (filters.push((r) => String(r[c]) >= v), b),
        lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), b),
        order: () => b,
        range: (a: number, z: number) => ((range = [a, z]), b),
        single: () => ((single = true), b),
        then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
          if (op === "insert") {
            if (opts.missingColumn && values.some((v) => opts.missingColumn! in v)) {
              return resolve({
                data: null,
                error: { code: "PGRST204", message: `Could not find the '${opts.missingColumn}' column of 'receipts' in the schema cache` },
              });
            }
            if (opts.rejectRow && values.some(opts.rejectRow)) return resolve({ data: null, error: { message: "rejected" } });
            log.inserts.push(values.length);
            const made = values.map((v) => ({ ...v, id: `new-${++counter}` }));
            receipts.push(...made);
            const out = made.map((m) => ({ id: m.id }));
            return resolve({ data: single ? out[0] : out, error: null });
          }
          let found = rows().filter((r) => filters.every((f) => f(r)));
          if (op === "delete") {
            for (const r of found) receipts.splice(receipts.indexOf(r), 1);
            return resolve({ data: found.map((r) => ({ id: r.id })), error: null });
          }
          if (range) found = found.slice(range[0], range[1] + 1);
          return resolve({ data: found, error: null });
        },
      };
      return b;
    },
  };
  return { db: db as unknown as Parameters<typeof handleExpenseImport>[0], receipts, log };
}

const wire = (over: Partial<ExpenseImportRow> = {}) => ({ ...row(), ...over });
const send = (rows: unknown[], mode: "preview" | "apply" = "apply", extra: Row = {}) => ({
  mode,
  default_category: "Materials & Supplies",
  rows,
  ...extra,
});

test("server: the preview plans every row and writes nothing", async () => {
  const { db, receipts } = makeDb();
  const r = await handleExpenseImport(db, "u1", send([wire(), wire({ row: 3, total: 0 })], "preview"));
  assert.equal(r.status, 200);
  const rows = r.body.rows as { row: number; status: string }[];
  assert.deepEqual(rows.map((x) => [x.row, x.status]), [[2, "ready"], [3, "error"]]);
  assert.equal(receipts.length, 0);
});

test("server: apply saves ordinary expenses - no image, no job, the invoice number, the resolved category, the tax", async () => {
  const { db, receipts } = makeDb();
  const r = await handleExpenseImport(
    db,
    "u1",
    send([wire({ invoice_number: " inv-7 ", description: "Paint", category: "job materials", total: 113 })]),
  );
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.imported, r.body.skipped, (r.body.failed as unknown[]).length], [1, 0, 0]);
  assert.equal((r.body.created_ids as string[]).length, 1);
  const saved = receipts[0];
  assert.deepEqual(
    {
      user_id: saved.user_id,
      image_url: saved.image_url,
      job_name: saved.job_name,
      merchant_name: saved.merchant_name,
      transaction_date: saved.transaction_date,
      total_amount: saved.total_amount,
      tax_amount: saved.tax_amount,
      tax_category: saved.tax_category,
      invoice_number: saved.invoice_number,
    },
    { user_id: "u1", image_url: null, job_name: null, merchant_name: "Acme", transaction_date: "2026-03-14", total_amount: 113, tax_amount: 13, tax_category: "Materials & Supplies", invoice_number: "inv-7" },
  );
  assert.equal((saved.items as { name: string }[])[0].name, "Paint");
  for (const k of ["origin", "from_statement", "tax_rate", "file_sha256"]) assert.equal(k in saved, false, `${k} is not set`);
});

test("server: a duplicate is skipped unless the person chose Import anyway; an unticked row is skipped", async () => {
  const seeded = [{ user_id: "u1", merchant_name: "Acme", invoice_number: "A-1", transaction_date: "2026-01-01", total_amount: 5 }];
  const a = makeDb({ receipts: seeded });
  const skipped = await handleExpenseImport(a.db, "u1", send([wire({ invoice_number: "a 1" })]));
  assert.deepEqual([skipped.body.imported, skipped.body.skipped], [0, 1]);
  const b = makeDb({ receipts: seeded });
  const anyway = await handleExpenseImport(b.db, "u1", send([wire({ invoice_number: "a 1", import_anyway: true })]));
  assert.deepEqual([anyway.body.imported, anyway.body.skipped], [1, 0]);
  const c = makeDb();
  const unticked = await handleExpenseImport(c.db, "u1", send([wire({ skip: true }), wire({ row: 3, total: 50 })]));
  assert.deepEqual([unticked.body.imported, unticked.body.skipped], [1, 1]);
});

test("server: another owner's expenses are never compared against", async () => {
  const { db } = makeDb({ receipts: [{ user_id: "u2", merchant_name: "Acme", invoice_number: "A-1", transaction_date: "2026-03-14", total_amount: 113 }] });
  const r = await handleExpenseImport(db, "u1", send([wire({ invoice_number: "A-1" })], "preview"));
  assert.equal((r.body.rows as { status: string }[])[0].status, "ready");
});

test("server: it re-validates - a client cannot save a bad row by claiming it is fine", async () => {
  const { db, receipts } = makeDb();
  const bad = [
    wire({ row: 2, supplier: "" }),
    wire({ row: 3, date: "14/03/2026" }),
    wire({ row: 4, total: 0 }),
    wire({ row: 5, tax: 500 }),
    wire({ row: 6, total: null }),
    { ...wire({ row: 7 }), total: "113" },
    { ...wire({ row: 8 }), date: 20260314 },
    wire({ row: 9, total: 1e12 }),
    { row: 10, status: "ready", expense: { total_amount: 1 } },
    "garbage",
    null,
  ];
  const r = await handleExpenseImport(db, "u1", send(bad));
  assert.equal(r.status, 200);
  assert.equal(r.body.imported, 0);
  assert.equal((r.body.failed as unknown[]).length, bad.length);
  assert.equal(receipts.length, 0);
  const text = JSON.stringify(r.body);
  assert.doesNotMatch(text, /garbage/, "nothing the client sent is echoed back");
});

test("server: the tax is recomputed on the server, whatever the request says about estimating", async () => {
  const { db, receipts } = makeDb();
  await handleExpenseImport(db, "u1", send([{ ...wire({ total: 113 }), tax_amount: 99, tax_estimated: false, expense: { tax_amount: 99 } }]));
  assert.equal(receipts[0].tax_amount, 13);
});

test("server: row and size limits", async () => {
  const { db } = makeDb();
  const many = (n: number) => Array.from({ length: n }, (_, i) => wire({ row: i + 2, total: 10 + i, supplier: `S${i}` }));
  assert.equal(EXPENSE_IMPORT_MAX_ROWS, 500);
  assert.equal(IMPORT_MAX_ROWS, 500);
  assert.equal(EXPENSE_IMPORT_MAX_BYTES, 1024 * 1024);
  assert.equal(IMPORT_MAX_BYTES, 1024 * 1024);
  assert.equal((await handleExpenseImport(db, "u1", send(many(501), "preview"))).status, 400);
  assert.equal((await handleExpenseImport(db, "u1", send(many(500), "preview"))).status, 200);
  assert.equal((await handleExpenseImport(db, "u1", send([], "preview"))).status, 400);
  assert.equal((await handleExpenseImport(db, "u1", { mode: "apply", rows: "nope" })).status, 400);
  assert.equal((await handleExpenseImport(db, "u1", { mode: "explode", rows: many(1) })).status, 400);
  assert.equal((await handleExpenseImport(db, "u1", null)).status, 400);
  // the route turns away a body over 1 MB before parsing it, and the dialog refuses a bigger file
  const route = read("../app/api/receipts/import/route.ts");
  assert.match(route, /Buffer\.byteLength\(text, "utf8"\) > EXPENSE_IMPORT_MAX_BYTES/);
  assert.match(route, /status: 413/);
  assert.match(read("../components/dashboard/import-expenses-dialog.tsx"), /file\.size > IMPORT_MAX_BYTES/);
  assert.match(read("../components/dashboard/import-expenses-dialog.tsx"), /parsed\.rows\.length > IMPORT_MAX_ROWS/);
});

test("server: 500 rows are saved in batches, and the summary adds up", async () => {
  const { db, receipts, log } = makeDb();
  const rows = Array.from({ length: 500 }, (_, i) => wire({ row: i + 2, supplier: `Supplier ${i}`, total: 20 + i }));
  const r = await handleExpenseImport(db, "u1", send(rows));
  assert.equal(r.body.imported, 500);
  assert.equal(receipts.length, 500);
  assert.equal(EXPENSE_IMPORT_BATCH, 100);
  assert.deepEqual(log.inserts, [100, 100, 100, 100, 100]);
  assert.equal((r.body.created_ids as string[]).length, 500);
});

test("server: one bad row in a batch costs only that row, and it is reported by number with fixed wording", async () => {
  const { db, receipts } = makeDb({ rejectRow: (r) => r.merchant_name === "Poison" });
  const r = await handleExpenseImport(
    db,
    "u1",
    send([wire({ row: 2, supplier: "Fine A" }), wire({ row: 3, supplier: "Poison" }), wire({ row: 4, supplier: "Fine B" })]),
  );
  assert.deepEqual([r.body.imported, r.body.skipped], [2, 0]);
  assert.deepEqual(r.body.failed, [{ row: 3, reason: "Could not save this row" }]);
  assert.deepEqual(receipts.map((x) => x.merchant_name), ["Fine A", "Fine B"]);
});

test("server: credit notes are saved as negative expenses", async () => {
  const { db, receipts } = makeDb();
  await handleExpenseImport(db, "u1", send([wire({ total: -113 })]));
  assert.deepEqual([receipts[0].total_amount, receipts[0].tax_amount], [-113, -13]);
});

// ---- undo ----------------------------------------------------------------------------------------

test("undo removes only this owner's image-less expenses from the ids it is given", async () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];
  const { db, receipts } = makeDb({
    receipts: [
      { id: ids[0], user_id: "u1", image_url: null },
      { id: ids[1], user_id: "u2", image_url: null },
      { id: ids[2], user_id: "u1", image_url: "u1/scan.jpg" },
    ],
  });
  const r = await handleExpenseImportUndo(db, "u1", { ids });
  assert.deepEqual([r.status, r.body.removed], [200, 1]);
  assert.deepEqual(receipts.map((x) => x.id).sort(), [ids[1], ids[2]].sort(), "another owner's row and a scanned receipt stay");
  for (const bad of [{ ids: [] }, { ids: ["nope"] }, { ids: "x" }, null, { ids: Array(501).fill(ids[0]) }]) {
    assert.equal((await handleExpenseImportUndo(db, "u1", bad)).status, 400);
  }
});

// ---- caps, scans, privacy ---------------------------------------------------------------------------

test("imports never count against the receipt scan allowance: only expenses with a scanned image count", () => {
  const route = read("../app/api/parse-receipt/route.ts");
  const count = route.slice(route.indexOf('.from("receipts")'), route.indexOf("FREE_SCAN_LIMIT)", route.indexOf('.from("receipts")')));
  assert.match(count, /\.not\("image_url", "is", null\)/);
  assert.match(count, /\.is\("origin", null\)/);
  assert.match(count, /gte\("created_at"/);
  // an import saves rows with no image at all
  assert.match(read("./expense-import-server.ts"), /image_url: null/);
});

test("no expense limit exists to respect: manual entry has no cap in plan-limits", () => {
  assert.doesNotMatch(read("./plan-limits.ts"), /expensesPerMonth|receiptsTotal|manualExpenses/);
});

test("no AI and no logging anywhere in the expense import", () => {
  for (const file of ["./expense-import.ts", "./expense-import-server.ts", "../app/api/receipts/import/route.ts", "../app/api/receipts/import/undo/route.ts", "../components/dashboard/import-expenses-dialog.tsx"]) {
    const src = read(file);
    assert.doesNotMatch(src, /gemini|genai|parseReceiptImage|openai|anthropic/i, `${file} has no AI`);
    assert.doesNotMatch(src, /console\.|captureRouteError|Sentry/, `${file} logs nothing`);
  }
});

test("only mapped rows are sent: the dialog never posts the file text", () => {
  const src = read("../components/dashboard/import-expenses-dialog.tsx");
  assert.doesNotMatch(src, /FormData|body: fileText|rows: fileText|JSON\.stringify\(fileText/);
  assert.match(src, /rows: built\.rows/);
  assert.match(src, /rows: toSend/);
});

// ---- the client import is unchanged --------------------------------------------------------------

test("the client import's own mapping is exactly what it was", () => {
  assert.deepEqual(guessMapping(["Client Name", "E-mail", "Mobile", "Street Address", "Notes"]), ["name", "email", "phone", "address", "ignore"]);
  assert.deepEqual(guessMapping(["Name", "Customer", "Email"]), ["name", "ignore", "email"], "one column per field");
  assert.deepEqual(guessMapping(["City", "Postal Code"]), ["ignore", "ignore"]);
  // and the generic helper behaves the same on the same synonyms
  assert.deepEqual(guessMappingWith(["Name", "Phone"], { name: ["name"], phone: ["phone"] }), ["name", "phone"]);
  const src = read("./client-import.ts");
  assert.match(src, /export type ImportTarget = "name" \| "email" \| "phone" \| "address" \| "ignore";/);
});

// ---- "Date for rows without a date" -----------------------------------------------------------------

const PICKED = "2026-03-01";
const NOW = new Date("2026-10-29T15:00:00Z"); // Toronto's today: 2026-10-29

test("no date column + a picked date: every row is sent undated and the server dates it, marked 'date set at import'", () => {
  const t = table("Vendor,Total\nAcme,113.00\nRona,50.00\n");
  const built = buildImportRows(t, ["supplier", "total"], { supplierName: "", dateOrder: null, fallbackDate: PICKED });
  assert.equal(built.problems.length, 0);
  assert.deepEqual(built.rows.map((r) => r.date), ["", ""], "the browser leaves the date to the server");
  const planned = plan(built.rows, ctx({ fallbackDate: PICKED }));
  for (const p of planned) {
    assert.equal(p.status, "ready");
    assert.equal(p.expense!.transaction_date, PICKED);
    assert.equal(p.expense!.date_set_at_import, true);
  }
});

test("date column with blank cells + a picked date: only the blank cells take it", () => {
  const t = table("Date,Vendor,Total\n2026-02-10,Acme,10.00\n,Acme,20.00\n  ,Acme,30.00\n");
  const built = buildImportRows(t, ["date", "supplier", "total"], { supplierName: "", dateOrder: null, fallbackDate: PICKED });
  assert.equal(built.problems.length, 0);
  assert.deepEqual(built.rows.map((r) => r.date), ["2026-02-10", "", ""]);
  const planned = plan(built.rows, ctx({ fallbackDate: PICKED }));
  assert.deepEqual(planned.map((p) => [p.expense!.transaction_date, p.expense!.date_set_at_import]), [
    ["2026-02-10", false],
    [PICKED, true],
    [PICKED, true],
  ]);
});

test("a date in the file always wins over the picker, and an unreadable one is an error, never replaced", () => {
  const t = table("Date,Vendor,Total\n2026-02-10,Acme,10.00\nsoon,Acme,20.00\n14/03/2026,Acme,30.00\n");
  const built = buildImportRows(t, ["date", "supplier", "total"], { supplierName: "", dateOrder: "dmy", fallbackDate: PICKED });
  assert.deepEqual(built.rows.map((r) => r.date), ["2026-02-10", "2026-03-14"]);
  assert.deepEqual(built.problems.map((p) => p.row), [3], "'soon' is not blank: it is reported, not silently dated");
  const p = plan(built.rows, ctx({ fallbackDate: PICKED }));
  assert.deepEqual(p.map((x) => x.expense!.date_set_at_import), [false, false]);
  // even a row sent WITH a date to a server that has a picked date keeps its own
  const mixed = plan([row({ row: 2, date: "2026-02-10" })], ctx({ fallbackDate: PICKED }))[0];
  assert.equal(mixed.expense!.transaction_date, "2026-02-10");
  assert.equal(mixed.expense!.items.some((i) => i.name === DATE_SET_AT_IMPORT_NOTE), false, "no note on a file-dated row");
});

test("a missing picker blocks the preview when there is no date column, and not when there is one", () => {
  assert.equal(mappingProblems(["supplier", "total"], "").length, 1);
  assert.match(mappingProblems(["supplier", "total"], "")[0], /date/i);
  assert.deepEqual(mappingProblems(["supplier", "total"], PICKED), []);
  assert.deepEqual(mappingProblems(["date", "total"], ""), [], "a date column mapped: the picker is optional");
  assert.deepEqual(mappingProblems(["date", "total"], PICKED), []);
  // and without a picker a blank date is still a row error: the browser sends it, the server refuses it
  const t = table("Date,Total\n,10.00\n");
  const built = buildImportRows(t, ["date", "total"], { supplierName: "X", dateOrder: null });
  assert.deepEqual([built.problems.length, built.rows.map((r) => r.date)], [0, [""]]);
  // the row's supplier is the dialog's default and it has no date or invoice number, so it reads as a total
  // row: either way it is not imported
  const p = plan(built.rows)[0];
  assert.notEqual(decideRow(p, {}), "import", "no picker, no date, no import");
  assert.notEqual(decideRow(p, { import_anyway: true }), "import");
  assert.equal(one({ date: "" }).status, "error");
  assert.equal(one({ date: "" }).messages[0], "No date");
});

test("the marker and the note: 'Date set at import' is added next to the owner's description, never over it", () => {
  const p = one({ date: "", description: "Pipe and fittings", total: 113 }, ctx({ fallbackDate: PICKED }));
  assert.equal(p.expense!.date_set_at_import, true);
  assert.deepEqual(p.expense!.items.map((i) => i.name), ["Pipe and fittings", "HST estimated from the category's default tax code (imported from CSV)", DATE_SET_AT_IMPORT_NOTE]);
  assert.equal(p.expense!.items[0].name, "Pipe and fittings");
  // with no description the note is the only item
  assert.deepEqual(one({ date: "", tax: 13 }, ctx({ fallbackDate: PICKED })).expense!.items.map((i) => i.name), [DATE_SET_AT_IMPORT_NOTE]);
  assert.equal(DATE_SET_AT_IMPORT_NOTE, "Date set at import");
});

test("the ambiguous-date question is only about dates in the file: never asked when the picker dates everything", () => {
  // no date column: even a column full of slash-style text is not a date column, so no question
  const t = table("Vendor,Reference,Total\nAcme,03/04/2026,10.00\nAcme,05/06/2026,20.00\n");
  assert.equal(dateFormatQuestion(t, ["supplier", "ignore", "total"]), null);
  assert.equal(dateFormatQuestion(t, ["supplier", "invoice_number", "total"]), null);
  // the same cells mapped as the date DO raise it
  assert.deepEqual(dateFormatQuestion(t, ["supplier", "date", "total"]), { needsChoice: true, detected: null });
  // a date column of ISO dates and blanks does not
  const iso = table("Date,Total\n2026-03-01,10.00\n,20.00\n");
  assert.deepEqual(dateFormatQuestion(iso, ["date", "total"]), { needsChoice: false, detected: null });
  // blanks never count as slash dates
  assert.equal(dateFormatQuestion(table("Date,Total\n,10.00\n,20.00\n"), ["date", "total"])!.needsChoice, false);
  // and the dialog asks only through that function
  const src = read("../components/dashboard/import-expenses-dialog.tsx");
  assert.match(src, /dateFormatQuestion\(table, mapping\)/);
  assert.match(src, /dateAnalysis\?\.needsChoice && \(/);
});

test("duplicates are unchanged; the no-invoice-number warning now uses the filled-in date", () => {
  const saved = ctx({
    fallbackDate: PICKED,
    existing: [
      existing({ merchant_name: "Acme", invoice_number: null, transaction_date: PICKED, total_amount: 113 }),
      existing({ merchant_name: "Acme", invoice_number: "A-1", transaction_date: "2025-01-01", total_amount: 5 }),
    ],
  });
  const warn = one({ date: "", total: 113 }, saved);
  assert.equal(warn.status, "warning", "same supplier + the picked date + same total");
  assert.match(warn.messages.join(" "), /already saved/);
  assert.equal(one({ date: "", total: 113 }, { ...saved, fallbackDate: "2026-03-02" }).status, "ready", "another picked date");
  // invoice number + supplier still decides a duplicate, whatever date the row ends up with
  assert.equal(one({ date: "", invoice_number: "a 1", total: 999 }, saved).status, "duplicate");
  assert.equal(one({ date: "2026-05-05", invoice_number: "a 1", total: 999 }, saved).status, "duplicate");
  // two undated rows in one file with the same supplier and total: the second warns (same filled-in date)
  const inFile = plan([row({ row: 2, date: "" }), row({ row: 3, date: "" })], ctx({ fallbackDate: PICKED }));
  assert.deepEqual(inFile.map((x) => x.status), ["ready", "warning"]);
});

test("server: it validates the picked date - a real date, not before 2000, not in the future - on preview and apply", async () => {
  const bad: unknown[] = ["2026-02-30", "not a date", "14/03/2026", 20260301, {}, "1999-12-31", "2026-12-01", "2027-01-01"];
  for (const mode of ["preview", "apply"] as const) {
    for (const fallback_date of bad) {
      const { db, receipts } = makeDb();
      const r = await handleExpenseImport(db, "u1", send([wire({ date: "" })], mode, { fallback_date }), NOW);
      assert.equal(r.status, 400, `${mode} ${String(fallback_date)}`);
      assert.match(String(r.body.error), /date for rows without a date/i);
      assert.equal(receipts.length, 0, "nothing is written");
    }
  }
  const future = await handleExpenseImport(makeDb().db, "u1", send([wire({ date: "" })], "apply", { fallback_date: "2026-12-01" }), NOW);
  assert.match(String(future.body.error), /future/);
  const invalid = await handleExpenseImport(makeDb().db, "u1", send([wire({ date: "" })], "apply", { fallback_date: "2026-02-30" }), NOW);
  assert.match(String(invalid.body.error), /valid date/);
  // today is fine; blank and absent mean no picker
  for (const fallback_date of ["2026-10-29", "2026-03-01"]) {
    const ok = await handleExpenseImport(makeDb().db, "u1", send([wire({ date: "" })], "preview", { fallback_date }), NOW);
    assert.equal(ok.status, 200, fallback_date);
  }
  for (const extra of [{ fallback_date: "" }, { fallback_date: null }, {}]) {
    const none = await handleExpenseImport(makeDb().db, "u1", send([wire({ date: "" })], "preview", extra), NOW);
    assert.equal(none.status, 200);
    assert.equal((none.body.rows as { status: string }[])[0].status, "error", "an undated row with no picker is an error");
  }
});

test("server: apply dates the row from the request's picker, saves the note, and ignores any claim in the row", async () => {
  const { db, receipts } = makeDb();
  const r = await handleExpenseImport(
    db,
    "u1",
    send(
      [
        { ...wire({ row: 2, date: "", description: "Pipe", supplier: "Acme" }), date_set_at_import: false, transaction_date: "1999-01-01" },
        wire({ row: 3, date: "2026-02-10", supplier: "Rona" }),
      ],
      "apply",
      { fallback_date: PICKED },
    ),
    NOW,
  );
  assert.deepEqual([r.body.imported, (r.body.failed as unknown[]).length], [2, 0]);
  const [first, second] = receipts;
  assert.equal(first.transaction_date, PICKED);
  assert.deepEqual((first.items as { name: string }[]).map((i) => i.name).filter((n) => n !== "HST estimated from the category's default tax code (imported from CSV)"), ["Pipe", DATE_SET_AT_IMPORT_NOTE]);
  assert.equal(second.transaction_date, "2026-02-10");
  assert.equal((second.items as { name: string }[]).some((i) => i.name === DATE_SET_AT_IMPORT_NOTE), false);
});

test("server: duplicates against saved expenses use the picked date for the no-invoice rule", async () => {
  const seeded = [{ user_id: "u1", merchant_name: "Acme", invoice_number: null, transaction_date: PICKED, total_amount: 113 }];
  const { db } = makeDb({ receipts: seeded });
  const r = await handleExpenseImport(db, "u1", send([wire({ date: "" })], "preview", { fallback_date: PICKED }), NOW);
  assert.equal((r.body.rows as { status: string }[])[0].status, "warning");
});

test("the dialog sends the picked date with the preview AND the apply request, keeps it in state only, and marks the rows", () => {
  const src = read("../components/dashboard/import-expenses-dialog.tsx");
  assert.equal((src.match(/\.\.\.\(fallbackDate && \{ fallback_date: fallbackDate \}\)/g) ?? []).length, 2);
  assert.match(src, /useState\(""\);\s*\n\s*const \[busy/, "it is plain dialog state");
  assert.match(src, /writeSaved\(headingsKey\(table\.headers\), JSON\.stringify\(mapping\)\)/, "only the mapping is remembered");
  assert.doesNotMatch(src, /setItem\([^)]*fallback|writeSaved\([^)]*fallback/i, "the date never reaches localStorage");
  assert.match(src, /date set at import/);
  assert.match(src, /Date for rows without a date/);
  assert.match(src, /setFallbackDate\(""\)/, "cleared when the dialog closes");
});

// ---- rows that look like a spreadsheet total ---------------------------------------------------------------

const dated = (over: Partial<ExpenseImportRow>) => row({ date: "2026-03-14", ...over });
const flagsOf = (rows: ExpenseImportRow[]) => detectTotalRows(rows);

test("rule a: a text cell that says exactly total / totals / grand total / sub total / subtotal / sum", () => {
  for (const label of ["Total", "TOTALS", " grand total ", "Grand   Total", "Sub Total", "subtotal", "Sum", "Total:", "TOTAL :", " sum:: "]) {
    assert.equal(isTotalLabel(label), true, label);
  }
  // in any of the text cells: supplier, invoice number, description, category
  for (const field of ["supplier", "invoice_number", "description", "category"] as const) {
    const r = dated({ [field]: "Grand Total", total: 60 });
    assert.equal(flagsOf([r])[0], TOTAL_REASONS.label, field);
  }
});

test("rule a is an EXACT match: names that merely contain the word are ordinary", () => {
  for (const name of ["Total Fuel", "Totalline Supply", "Grand Totals Inc", "Subtotal items", "Sumner Hardware", "Sum of parts", "Totally Tools", "", "  ", "Totalx", "T otal"]) {
    assert.equal(isTotalLabel(name), false, name);
  }
  const rows = [dated({ supplier: "Total Fuel", total: 40 }), dated({ row: 3, supplier: "Totalline Supply", invoice_number: "T-1", total: 10 })];
  assert.deepEqual(flagsOf(rows), [null, null]);
  assert.deepEqual(plan(rows).map((p) => p.status), ["ready", "ready"]);
});

test("rule b: an amount with no supplier, invoice number or date", () => {
  const bare = row({ supplier: "", date: "", invoice_number: "", total: 500 });
  assert.equal(flagsOf([bare])[0], TOTAL_REASONS.bare);
  // each missing piece on its own is not enough
  assert.equal(flagsOf([{ ...bare, supplier: "Acme" }])[0], null, "has a supplier");
  assert.equal(flagsOf([{ ...bare, invoice_number: "INV-1" }])[0], null, "has an invoice number");
  assert.equal(flagsOf([{ ...bare, date: "2026-03-14" }])[0], null, "has a date");
  // no amount at all: nothing to be a total of
  assert.equal(flagsOf([{ ...bare, total: null }])[0], null);
  // a subtotal or a tax figure counts as an amount; a blank tax cell (0) does not
  assert.equal(flagsOf([{ ...bare, total: null, subtotal: 100 }])[0], TOTAL_REASONS.bare);
  assert.equal(flagsOf([{ ...bare, total: null, tax: 13 }])[0], TOTAL_REASONS.bare);
  assert.equal(flagsOf([{ ...bare, total: null, tax: 0 }])[0], null);
});

test("rule b ignores the picker's date and the dialog's one supplier name: it reads what the row itself said", () => {
  const picker = ctx({ fallbackDate: "2026-03-01" });
  const bare = row({ supplier: "", date: "", total: 500 });
  const p = plan([bare], picker)[0];
  assert.equal(p.status, "total", "the picker's date does not make it a dated row");
  assert.equal(p.messages[0], TOTAL_REASONS.bare);
  // the file has no supplier column, so every row carries the dialog's name; the row itself said nothing
  const defaulted = row({ supplier: "Acme Paint", supplier_defaulted: true, date: "", total: 500 });
  assert.equal(flagsOf([defaulted])[0], TOTAL_REASONS.bare);
  assert.equal(flagsOf([{ ...defaulted, supplier_defaulted: false }])[0], null, "a row that really names its supplier is an invoice");
  assert.equal(flagsOf([{ ...defaulted, invoice_number: "INV-9" }])[0], null);
  // and buildImportRows sets that hint exactly when the name came from the dialog
  const t = table("Date,Vendor,Amount\n2026-03-01,Rona,10\n2026-03-02,,20\n");
  const built = buildImportRows(t, ["date", "supplier", "total"], { supplierName: "Acme", dateOrder: null });
  assert.deepEqual(built.rows.map((r) => [r.supplier, r.supplier_defaulted]), [["Rona", false], ["Acme", true]]);
});

test("rule c: no invoice number, and the total equals the sum of the other (unflagged) rows", () => {
  const items = [dated({ row: 2, supplier: "A", total: 10 }), dated({ row: 3, supplier: "B", total: 20 }), dated({ row: 4, supplier: "C", total: 30 })];
  const footer = dated({ row: 5, supplier: "Acme", total: 60 });
  assert.deepEqual(flagsOf([...items, footer]), [null, null, null, TOTAL_REASONS.sum]);
  // within a cent either way, not two
  assert.equal(flagsOf([...items, { ...footer, total: 60.01 }])[3], TOTAL_REASONS.sum);
  assert.equal(flagsOf([...items, { ...footer, total: 59.99 }])[3], TOTAL_REASONS.sum);
  assert.equal(flagsOf([...items, { ...footer, total: 60.02 }])[3], null);
  // an invoice number makes it an invoice, however well the sum works out
  assert.equal(flagsOf([...items, { ...footer, invoice_number: "INV-60" }])[3], null);
  // it works in any position, and with subtotal + tax instead of a total
  assert.equal(flagsOf([footer, ...items])[0], TOTAL_REASONS.sum);
  assert.equal(flagsOf([...items, { ...footer, total: null, subtotal: 53.1, tax: 6.9 }])[3], TOTAL_REASONS.sum);
  // credit notes count with their sign
  const withCredit = [dated({ row: 2, total: 100 }), dated({ row: 3, supplier: "B", total: -30 }), dated({ row: 4, supplier: "C", total: 20 })];
  assert.equal(flagsOf([...withCredit, dated({ row: 5, supplier: "Z", total: 90 })])[3], TOTAL_REASONS.sum);
});

test("rule c leaves legitimate files alone: a single row, two rows, two equal purchases", () => {
  assert.deepEqual(flagsOf([dated({ total: 113 })]), [null], "the only row is never 'the sum of the others'");
  assert.deepEqual(flagsOf([dated({ row: 2, total: 50 }), dated({ row: 3, supplier: "B", total: 50 })]), [null, null], "two $50 purchases");
  assert.deepEqual(flagsOf([dated({ row: 2, total: 10 }), dated({ row: 3, supplier: "B", total: 20 })]), [null, null]);
  assert.deepEqual(flagsOf([]), []);
  // rows already flagged by a or b are not counted among "the others"
  const rows = [
    dated({ row: 2, supplier: "A", total: 10 }),
    dated({ row: 3, supplier: "B", total: 20 }),
    dated({ row: 4, supplier: "Total", total: 30 }),
    dated({ row: 5, supplier: "Acme", total: 30 }),
  ];
  assert.deepEqual(flagsOf(rows), [null, null, TOTAL_REASONS.label, TOTAL_REASONS.sum]);
});

test("a footer row with a total label becomes status 'total' with the reason first, and is skipped by default", () => {
  const rows = [
    dated({ row: 2, supplier: "Acme", total: 10, invoice_number: "A-1" }),
    dated({ row: 3, supplier: "Rona", total: 20, invoice_number: "A-2" }),
    dated({ row: 4, supplier: "Total", total: 30 }),
  ];
  const p = plan(rows);
  assert.deepEqual(p.map((x) => x.status), ["ready", "ready", "total"]);
  assert.equal(p[2].messages[0], TOTAL_REASONS.label);
  assert.ok(p[2].expense, "it could be imported on purpose");
  assert.equal(decideRow(p[2], {}), "skip");
  assert.equal(decideRow(p[2], { import_anyway: true }), "import");
  assert.equal(decideRow(p[2], { import_anyway: true, skip: true }), "skip");
  assert.doesNotMatch(p[2].messages.join(" "), /Total\b(?! row)/, "the cell's own text is not echoed");
});

test("a footer row with no label whose amount equals the sum is caught too", () => {
  const rows = [
    dated({ row: 2, supplier: "Acme", total: 11.5 }),
    dated({ row: 3, supplier: "Rona", total: 22.25, date: "2026-03-15" }),
    dated({ row: 4, supplier: "Esso", total: 40, date: "2026-03-16" }),
    dated({ row: 5, supplier: "Acme", total: 73.75, date: "2026-03-20" }),
  ];
  const p = plan(rows);
  assert.deepEqual(p.map((x) => x.status), ["ready", "ready", "ready", "total"]);
  assert.equal(p[3].messages[0], TOTAL_REASONS.sum);
});

test("a total row that can't become an expense (no supplier, no date) is left out, not counted as a failure", () => {
  const p = plan([row({ supplier: "", date: "", total: 500 })])[0];
  assert.deepEqual([p.status, p.expense], ["total", null]);
  assert.match(p.messages.join(" | "), /No date|No supplier/);
  assert.equal(decideRow(p, { import_anyway: true }), "skip", "nothing to import even on purpose");
  assert.equal(decideRow(plan([row({ total: 0 })])[0], {}), "error", "an ordinary bad row is still an error");
});

test("a total-looking row does not make a later row its duplicate", () => {
  const p = plan([row({ row: 2, supplier: "Total", invoice_number: "A-1", total: 5 }), row({ row: 3, supplier: "Acme", invoice_number: "A-1", total: 5 })]);
  assert.deepEqual(p.map((x) => x.status), ["total", "ready"]);
});

test("the preview totals leave out skipped rows: total-looking rows count only when imported anyway", () => {
  const rows = [
    dated({ row: 2, supplier: "A", total: 113, invoice_number: "1" }),
    dated({ row: 3, supplier: "B", total: 226, invoice_number: "2" }),
    dated({ row: 4, supplier: "Grand Total", total: 339 }),
  ];
  const planned = plan(rows);
  const items = (inputs: Partial<ExpenseImportRow>[]) => planned.map((p, i) => ({ planned: p, input: inputs[i] ?? {} }));
  assert.deepEqual(planTotals(items([])), { rows: 2, total: 339, tax: 39 }, "the 339 grand total is not added in");
  assert.deepEqual(planTotals(items([{}, {}, { import_anyway: true }])), { rows: 3, total: 678, tax: 78 });
  assert.deepEqual(planTotals(items([{ skip: true }, {}, {}])), { rows: 1, total: 226, tax: 26 });
});

test("server: it re-detects total rows itself and ignores what the client says about them", async () => {
  const rows = [
    wire({ row: 2, supplier: "Acme", invoice_number: "A-1", total: 10 }),
    wire({ row: 3, supplier: "Rona", invoice_number: "A-2", total: 20 }),
    // the client claims everything is fine about the footer
    { ...wire({ row: 4, supplier: "TOTAL:", total: 30 }), status: "ready", looks_like_total: false, expense: { total_amount: 30 }, skip: false },
  ];
  const { db, receipts } = makeDb();
  const preview = await handleExpenseImport(db, "u1", send(rows, "preview"));
  assert.deepEqual((preview.body.rows as { status: string }[]).map((r) => r.status), ["ready", "ready", "total"]);

  const applied = await handleExpenseImport(db, "u1", send(rows, "apply"));
  assert.deepEqual([applied.body.imported, applied.body.skipped, (applied.body.failed as unknown[]).length], [2, 1, 0]);
  assert.deepEqual(receipts.map((r) => r.merchant_name), ["Acme", "Rona"]);
});

test("server: a flagged row is saved only when the request carries 'import anyway' for that row", async () => {
  const footer = (extra: Partial<ExpenseImportRow>) => wire({ row: 4, supplier: "Grand total", total: 30, ...extra });
  const base = [wire({ row: 2, supplier: "Acme", invoice_number: "A-1", total: 10 }), wire({ row: 3, supplier: "Rona", invoice_number: "A-2", total: 20 })];

  const none = makeDb();
  await handleExpenseImport(none.db, "u1", send([...base, footer({})]));
  assert.equal(none.receipts.length, 2);

  const falsy = makeDb();
  await handleExpenseImport(falsy.db, "u1", send([...base, { ...footer({}), import_anyway: "yes" }]));
  assert.equal(falsy.receipts.length, 2, "only a real boolean true counts, as for duplicates");

  const anyway = makeDb();
  const r = await handleExpenseImport(anyway.db, "u1", send([...base, footer({ import_anyway: true })]));
  assert.deepEqual([r.body.imported, r.body.skipped], [3, 0]);
  assert.equal(anyway.receipts[2].merchant_name, "Grand total");

  const unticked = makeDb();
  const u = await handleExpenseImport(unticked.db, "u1", send([...base, footer({ import_anyway: true, skip: true })]));
  assert.deepEqual([u.body.imported, u.body.skipped], [2, 1]);
});

test("a file with date and amount columns and ONE supplier name: the undated footer is caught end to end", async () => {
  const t = table("Date,Amount\n2026-03-01,10.00\n2026-03-02,20.00\n,30.00\n");
  const built = buildImportRows(t, ["date", "total"], { supplierName: "Acme Paint", dateOrder: null });
  assert.deepEqual(built.rows.map((r) => r.date), ["2026-03-01", "2026-03-02", ""]);
  const { db, receipts } = makeDb();
  const preview = await handleExpenseImport(db, "u1", send(built.rows, "preview"));
  assert.deepEqual((preview.body.rows as { status: string }[]).map((r) => r.status), ["ready", "ready", "total"]);
  const applied = await handleExpenseImport(db, "u1", send(built.rows, "apply"));
  assert.deepEqual([applied.body.imported, applied.body.skipped, (applied.body.failed as unknown[]).length], [2, 1, 0]);
  assert.equal(receipts.length, 2);
});

test("the dialog shows the status, skips these rows by default, and offers Import anyway only when they could import", () => {
  const src = read("../components/dashboard/import-expenses-dialog.tsx");
  assert.match(src, /total: \{ label: "Looks like a total"/);
  assert.match(src, /p\.status === "ready" \|\| p\.status === "warning"/, "only ready and warning rows start ticked");
  assert.match(src, /import_anyway: on && \(p\?\.status === "duplicate" \|\| p\?\.status === "total"\)/);
  assert.match(src, /disabled=\{status === "error" \|\| \(p !== null && p\.expense === null\)\}/);
  assert.match(src, /look\s+like totals/);
});

// ---- the import batch id (receipts.import_batch_id) ----------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("batch: every expense an import creates carries the same new batch id, and the answer returns it", async () => {
  const { db, receipts } = makeDb();
  const rows = [wire({ row: 2, supplier: "A" }), wire({ row: 3, supplier: "B", total: 50 }), wire({ row: 4, supplier: "C", total: 70 })];
  const r = await handleExpenseImport(db, "u1", send(rows));
  assert.equal(r.body.imported, 3);
  const id = r.body.import_batch_id as string;
  assert.match(id, UUID_RE);
  assert.deepEqual(receipts.map((x) => x.import_batch_id), [id, id, id]);
});

test("batch: a second import gets its own id, and skipped rows get none because they are never saved", async () => {
  const { db, receipts } = makeDb();
  const first = await handleExpenseImport(db, "u1", send([wire({ row: 2, supplier: "A" })]));
  const second = await handleExpenseImport(db, "u1", send([wire({ row: 2, supplier: "B" }), wire({ row: 3, supplier: "C", skip: true })]));
  assert.notEqual(first.body.import_batch_id, second.body.import_batch_id);
  assert.deepEqual(receipts.map((x) => x.import_batch_id), [first.body.import_batch_id, second.body.import_batch_id]);
});

test("batch: the id is generated by the server - one sent in the request is ignored", async () => {
  const { db, receipts } = makeDb();
  const r = await handleExpenseImport(
    db,
    "u1",
    { ...send([{ ...wire(), import_batch_id: "attacker" }]), import_batch_id: "11111111-1111-4111-8111-111111111111" },
  );
  assert.notEqual(r.body.import_batch_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(receipts[0].import_batch_id, r.body.import_batch_id);
});

test("batch: nothing saved means no batch id, and a preview creates none", async () => {
  const { db, receipts } = makeDb();
  assert.equal((await handleExpenseImport(db, "u1", send([wire({ total: 0 })]))).body.import_batch_id, null);
  const preview = await handleExpenseImport(db, "u1", send([wire()], "preview"));
  assert.equal("import_batch_id" in preview.body, false);
  assert.equal(receipts.length, 0);
});

test("batch: before migration 0074 the import still works - it retries without the column and says there is no batch", async () => {
  const { db, receipts } = makeDb({ missingColumn: "import_batch_id" });
  const rows = Array.from({ length: 250 }, (_, i) => wire({ row: i + 2, supplier: `S${i}`, total: 10 + i }));
  const r = await handleExpenseImport(db, "u1", send(rows));
  assert.deepEqual([r.body.imported, (r.body.failed as unknown[]).length, r.body.import_batch_id], [250, 0, null]);
  assert.equal(receipts.length, 250);
  assert.ok(receipts.every((x) => !("import_batch_id" in x)), "the column is not written at all");
});

test("batch: only a missing-column error triggers the retry; a bad row still fails on its own", async () => {
  const { db, receipts } = makeDb({ rejectRow: (r) => r.merchant_name === "Poison" });
  const r = await handleExpenseImport(db, "u1", send([wire({ row: 2, supplier: "Fine" }), wire({ row: 3, supplier: "Poison" })]));
  assert.deepEqual([r.body.imported, r.body.failed], [1, [{ row: 3, reason: "Could not save this row" }]]);
  assert.equal(typeof r.body.import_batch_id, "string", "the column is still used");
  assert.equal(receipts[0].import_batch_id, r.body.import_batch_id);
});
