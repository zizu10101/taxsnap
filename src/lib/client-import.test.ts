import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  IMPORT_FIELD_LIMITS,
  applyMapping,
  detectDelimiter,
  guessMapping,
  guessTarget,
  parseDelimited,
  planImport,
  remainingRoom,
  summaryText,
  unstoredColumnLabel,
  type ImportRow,
} from "./client-import.ts";

// ---- parser

test("strips a UTF-8 BOM and handles CRLF and blank lines", () => {
  const t = parseDelimited("﻿Name,Email\r\nAnn,ann@x.com\r\n\r\n   ,  \r\nBob,bob@x.com\r\n");
  assert.deepEqual(t.headers, ["Name", "Email"]);
  assert.deepEqual(t.rows.map((r) => r.cells), [["Ann", "ann@x.com"], ["Bob", "bob@x.com"]]);
});

test("row numbers follow the file, counting blank lines (the header is row 1)", () => {
  const t = parseDelimited("Name\nAnn\n\nBob");
  assert.deepEqual(t.rows.map((r) => r.row), [2, 4]);
});

test("quoted fields keep commas, doubled quotes and line breaks", () => {
  const t = parseDelimited('Name,Address\n"Smith, Jo","12 ""Main"" St\nUnit 4"\nAnn,"x"');
  assert.equal(t.rows[0].cells[0], "Smith, Jo");
  assert.equal(t.rows[0].cells[1], '12 "Main" St\nUnit 4');
  assert.equal(t.rows[1].cells[0], "Ann");
  assert.equal(t.rows[1].row, 4);
});

test("detects comma, semicolon and tab delimiters", () => {
  assert.equal(detectDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(detectDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(detectDelimiter("a\tb\tc\n1\t2\t3"), "\t");
  assert.equal(detectDelimiter("Name\nAnn"), ",");
  // delimiters inside quotes in the header are not counted
  assert.equal(detectDelimiter('"A, B";C\n1;2'), ";");
});

test("a tab-separated paste from a sheet keeps commas inside cells", () => {
  const t = parseDelimited("Name\tEmail\tAddress\nJordan Reyes\tj@x.com\t12 Main St, Toronto, ON\n");
  assert.equal(t.delimiter, "\t");
  assert.deepEqual(t.rows[0].cells, ["Jordan Reyes", "j@x.com", "12 Main St, Toronto, ON"]);
});

test("short rows are padded, fields trimmed, empty input gives nothing", () => {
  const t = parseDelimited("Name,Email,Address\n  Ann  \n");
  assert.deepEqual(t.rows[0].cells, ["Ann", "", ""]);
  assert.deepEqual(parseDelimited("").rows, []);
  assert.deepEqual(parseDelimited("\n\n  \n").headers, []);
});

// ---- column mapping

test("the first real sheet's headers map: Name, Email, Address, Phone; Total Billed is ignored", () => {
  const headers = ["Name", "Email", "Address", "Phone", "Total Billed"];
  assert.deepEqual(guessMapping(headers), ["name", "email", "address", "phone", "ignore"]);
});

test("those exact headers map in any capitalisation, including a tab-separated paste", () => {
  for (const variant of [(s: string) => s.toUpperCase(), (s: string) => s.toLowerCase(), (s: string) => s]) {
    const line = ["Name", "Email", "Address", "Phone", "Total Billed"].map(variant).join("\t");
    const t = parseDelimited(`${line}\nAnn\ta@x.com\t1 St\t555\t$900`);
    assert.deepEqual(guessMapping(t.headers), ["name", "email", "address", "phone", "ignore"]);
  }
});

test("other common header names are recognised", () => {
  for (const h of ["Full Name", "Client", "Customer", "Company", "client_name"]) assert.equal(guessTarget(h), "name", h);
  for (const h of ["E-mail", "e mail", "EMAIL ADDRESS"]) assert.equal(guessTarget(h), "email", h);
  for (const h of ["Street", "Street Address"]) assert.equal(guessTarget(h), "address", h);
  assert.equal(guessTarget("Client Since"), "ignore");
});

test("phone headers map to Phone in any capitalisation; city, province and postal are still ignored", () => {
  for (const h of ["phone", "PHONE", "Mobile", "CELL", "Tel", "Telephone", "Phone Number"]) {
    assert.equal(guessTarget(h), "phone", h);
    assert.equal(unstoredColumnLabel(h), null);
  }
  for (const h of ["City", "Province", "State", "Postal", "ZIP"]) {
    assert.equal(guessTarget(h), "ignore");
    assert.ok(unstoredColumnLabel(h));
  }
  assert.equal(unstoredColumnLabel("Total Billed"), null);
});

test("two columns that look like the same field: the first wins", () => {
  assert.deepEqual(guessMapping(["Name", "Customer", "Email"]), ["name", "ignore", "email"]);
});

test("Total Billed is never imported: not as an amount, payment, invoice or anything else", () => {
  assert.equal(guessTarget("Total Billed"), "ignore");
  assert.equal(guessTarget("TOTAL BILLED"), "ignore");
  const t = parseDelimited("Name\tEmail\tAddress\tPhone\tTotal Billed\nAnn\ta@x.com\t1 St\t555-1\t$12,345.00");
  const rows = applyMapping(t, guessMapping(t.headers));
  assert.deepEqual(Object.keys(rows[0]).sort(), ["address", "email", "name", "phone", "row"]);
  assert.ok(!JSON.stringify(rows).includes("12,345"));
  const plan = planImport([], rows, null);
  assert.deepEqual(plan.toInsert, [{ name: "Ann", email: "a@x.com", phone: "555-1", address: "1 St" }]);
  // even if a person forces the column onto a field, it is only ever text on that field, never an amount
  const src = readFileSync(new URL("../app/api/clients/import/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from\("(payments|documents|document_items|sales)"\)/);
});

test("Address stays one free-text field: it is not split into city, province or postal code", () => {
  const t = parseDelimited("Name,Address\nAnn,\"12 Main St, Toronto, ON M5V 1A1\"");
  const plan = planImport([], applyMapping(t, guessMapping(t.headers)), null);
  assert.equal(plan.toInsert[0].address, "12 Main St, Toronto, ON M5V 1A1");
});

// ---- rules

const row = (n: number, name: string, email = "", address = "", phone = ""): ImportRow => ({ row: n, name, email, phone, address });

test("rows without a name or with a bad email are problems, not failures; reasons never echo values", () => {
  const plan = planImport([], [row(2, ""), row(3, "Bob", "not-an-email"), row(4, "Cy", "cy@x.com")], null);
  assert.deepEqual(plan.problems, [
    { row: 2, reason: "No name" },
    { row: 3, reason: "Invalid email address" },
  ]);
  assert.equal(plan.toInsert.length, 1);
  assert.ok(!JSON.stringify(plan.problems).includes("not-an-email"));
});

test("fields are trimmed and capped to the length limits", () => {
  const long = "x".repeat(1000);
  const plan = planImport([], [row(2, `  ${long}  `, "", long)], null);
  assert.equal(plan.toInsert[0].name.length, IMPORT_FIELD_LIMITS.name);
  assert.equal(plan.toInsert[0].address!.length, IMPORT_FIELD_LIMITS.address);
  const longEmail = `${"a".repeat(IMPORT_FIELD_LIMITS.email)}@x.com`;
  assert.equal(planImport([], [row(2, "A", longEmail)], null).problems.length, 1);
});

test("duplicates: by email (case-insensitive) or by name, against existing clients and within the file", () => {
  const existing = [{ name: "Ann Lee", email: "ann@x.com" }, { name: "Bob", email: null }];
  const plan = planImport(
    existing,
    [
      row(2, "Someone Else", "ANN@X.COM"), // email matches an existing client
      row(3, "  bob  "), // name matches an existing client
      row(4, "Cy", "cy@x.com"),
      row(5, "Cy Again", "CY@x.com"), // email repeated in the file
      row(6, "CY"), // name repeated in the file
      row(7, "Di"),
      row(8, "Dee", "d@x.com"),
    ],
    null,
  );
  assert.deepEqual(plan.toInsert.map((c) => c.name), ["Cy", "Di", "Dee"]);
  assert.equal(plan.duplicates, 4);
});

test("the same name with a different email is a duplicate too (the database keeps one client per name)", () => {
  const plan = planImport([{ name: "Sam", email: "s1@x.com" }], [row(2, "sam", "s2@x.com")], null);
  assert.equal(plan.duplicates, 1);
  assert.equal(plan.toInsert.length, 0);
});

test("a problem row is not counted as a duplicate, and does not claim its name", () => {
  const plan = planImport([], [row(2, "Ann", "bad"), row(3, "Ann", "a@x.com")], null);
  assert.equal(plan.problems.length, 1);
  assert.equal(plan.toInsert.length, 1);
});

test("plan cap: imports up to the room left, counts the rest, in file order", () => {
  const rows = [row(2, "A"), row(3, "B"), row(4, "C"), row(5, "D"), row(6, "A")];
  const plan = planImport([], rows, 2);
  assert.deepEqual(plan.toInsert.map((c) => c.name), ["A", "B"]);
  assert.equal(plan.notImportedPlanLimit, 2); // C, D (the repeated A is a duplicate, not a plan-limit row)
  assert.equal(plan.duplicates, 1);
});

test("plan cap: no room imports nothing; Pro (null) is unlimited", () => {
  assert.equal(planImport([], [row(2, "A")], 0).notImportedPlanLimit, 1);
  assert.equal(planImport([], Array.from({ length: 500 }, (_, i) => row(i + 2, `N${i}`)), null).toInsert.length, 500);
  assert.equal(remainingRoom(3, 1), 2);
  assert.equal(remainingRoom(3, 5), 0);
  assert.equal(remainingRoom(null, 99), null);
});

test("a valid phone is saved (trimmed, extension kept)", () => {
  const plan = planImport([], [row(2, "Ann", "", "", "  +1 (416) 555-0100 ext 22 "), row(3, "Bob")], null);
  assert.equal(plan.toInsert[0].phone, "+1 (416) 555-0100 ext 22");
  assert.equal(plan.toInsert[1].phone, null);
  assert.equal(plan.phonesIgnored, 0);
});

test("an invalid phone is dropped but the row still imports, and is counted", () => {
  const plan = planImport(
    [],
    [row(2, "Ann", "a@x.com", "1 St", "call me"), row(3, "Bob", "", "", "1".repeat(41)), row(4, "Cy", "", "", "555-0100")],
    null,
  );
  assert.deepEqual(plan.toInsert.map((c) => [c.name, c.phone]), [["Ann", null], ["Bob", null], ["Cy", "555-0100"]]);
  assert.equal(plan.toInsert[0].email, "a@x.com");
  assert.equal(plan.phonesIgnored, 2);
  assert.equal(plan.problems.length, 0);
});

test("phones are only counted for rows that import (not duplicates, problems or plan-limit rows)", () => {
  const plan = planImport([{ name: "Dup", email: null }], [row(2, "Dup", "", "", "x"), row(3, "", "", "", "x"), row(4, "A", "", "", "x"), row(5, "B", "", "", "x")], 1);
  assert.equal(plan.phonesIgnored, 1);
  assert.equal(plan.notImportedPlanLimit, 1);
});

test("summary wording", () => {
  assert.equal(
    summaryText({ imported: 12, skippedDuplicates: 3, skippedProblems: 1, notImportedPlanLimit: 0 }),
    "12 imported, 3 skipped (duplicates), 1 skipped (problems), 0 not imported (plan limit)",
  );
  assert.equal(
    summaryText({ imported: 1, skippedDuplicates: 0, skippedProblems: 0, notImportedPlanLimit: 0, phonesIgnored: 2 }),
    "1 imported, 0 skipped (duplicates), 0 skipped (problems), 0 not imported (plan limit), 2 phone ignored",
  );
});

// ---- the API route (static checks on its source)

const route = readFileSync(new URL("../app/api/clients/import/route.ts", import.meta.url), "utf8");

test("route: the user id comes from the session, the rules run server-side, one batched insert", () => {
  assert.match(route, /requireUser\(\)/);
  assert.match(route, /user_id: user\.id/);
  assert.doesNotMatch(route, /body[^;\n]*user_id|\.user_id\b.*rows|o\.user_id/);
  assert.match(route, /planImport\(/);
  assert.match(route, /wouldExceedTotalLimit\(/);
  assert.match(route, /IMPORT_MAX_BYTES/);
  assert.match(route, /IMPORT_MAX_ROWS/);
  assert.equal((route.match(/\.insert\(/g) ?? []).length, 1);
});

test("route and dialog never log, and never store the file or pasted text", () => {
  const dialog = readFileSync(new URL("../components/clients/import-clients-dialog.tsx", import.meta.url), "utf8");
  for (const src of [route, dialog]) {
    assert.doesNotMatch(src, /console\.|logStripeError|\.storage\b|localStorage|sessionStorage|indexedDB/);
  }
  assert.doesNotMatch(route, /error\.message|err\.message/); // a database message can contain a client's name
});
