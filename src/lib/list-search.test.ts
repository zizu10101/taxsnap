import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  amountSearchText,
  matchesSearch,
  normalizeSearchText,
  searchList,
} from "./list-search.ts";
import {
  clientSearchFields,
  documentSearchFields,
  expenseSearchFields,
  hourSearchFields,
  jobSearchFields,
  nameSearchFields,
} from "./list-search-fields.ts";
import { filterSavedItems } from "./saved-items.ts";

const readLf = (path: string) => readFileSync(path, "utf8").split("\r\n").join("\n");

test("every typed word must match, in any order", () => {
  const row = ["Interior paint, per room"];
  assert.equal(matchesSearch(row, "paint room"), true);
  assert.equal(matchesSearch(row, "room paint"), true);
  assert.equal(matchesSearch(row, "paint ceiling"), false);
});

test("case does not matter", () => {
  assert.equal(matchesSearch(["Kitchen Reno"], "KITCHEN reno"), true);
});

test("accents are ignored in the row and in the query", () => {
  assert.equal(matchesSearch(["Café Rénové"], "cafe renove"), true);
  assert.equal(matchesSearch(["Cafe Renove"], "café rénové"), true);
  assert.equal(normalizeSearchText("  Éric   Lévesque "), "eric levesque");
});

test("an empty or blank query matches everything and returns the same array", () => {
  const items = [{ n: "a" }, { n: "b" }];
  for (const q of ["", "   ", "\t"]) {
    assert.equal(searchList(items, q, (i) => [i.n]), items);
  }
  assert.equal(matchesSearch([], ""), true);
});

test("no match returns an empty list", () => {
  const items = [{ n: "alpha" }, { n: "beta" }];
  assert.deepEqual(searchList(items, "zzz", (i) => [i.n]), []);
});

test("words may match different fields of the same row", () => {
  assert.equal(matchesSearch(["Ann Lee", "Kitchen reno", null, undefined], "kitchen ann"), true);
});

test("null, undefined and numeric fields are handled", () => {
  assert.equal(matchesSearch([null, undefined, 1004], "1004"), true);
  assert.equal(matchesSearch([null, undefined], "x"), false);
});

test("amounts match as typed with or without cents", () => {
  assert.equal(amountSearchText(45.5), "45.5 45.50");
  assert.equal(matchesSearch([amountSearchText(45.5)], "45.50"), true);
  assert.equal(matchesSearch([amountSearchText(45)], "45"), true);
  assert.equal(amountSearchText(null), "");
});

test("the saved-item picker uses the same rule (accents too)", () => {
  const items = [{ description: "Peinture intérieure, par pièce" }, { description: "Drywall" }];
  assert.equal(filterSavedItems(items, "interieure piece").length, 1);
  assert.equal(filterSavedItems(items, "").length, 2);
});

test("clients: name, email, address", () => {
  const c = { name: "Ann Lee", email: "ann@x.ca", address: "12 Elm St" };
  for (const q of ["lee", "x.ca", "elm", "ann elm"]) assert.ok(matchesSearch(clientSearchFields(c), q), q);
  assert.equal(matchesSearch(clientSearchFields(c), "bob"), false);
});

test("documents: number, client, job, place of work, status", () => {
  const d = {
    type: "invoice" as const,
    document_number: 1004,
    status: "partial",
    place_of_work: "55 Oak Ave",
    client: { name: "Ann Lee" },
    job: { name: "Kitchen reno" },
  };
  for (const q of ["inv-1004", "1004", "ann", "kitchen", "oak ave", "partial", "kitchen ann partial"]) {
    assert.ok(matchesSearch(documentSearchFields(d), q), q);
  }
  assert.equal(matchesSearch(documentSearchFields(d), "est-1004"), false);
  assert.ok(matchesSearch(documentSearchFields({ ...d, type: "estimate" }, { converted: true }), "converted"));
  // no client / no job / no place is fine
  assert.ok(matchesSearch(documentSearchFields({ type: "estimate", document_number: 7, status: "draft" }), "draft"));
});

test("jobs: name, location, customer, contract number", () => {
  const j = { name: "Kitchen reno", location: "55 Oak Ave", contract_number: 100 };
  for (const q of ["kitchen", "oak", "ann", "con-00100", "100"]) {
    assert.ok(matchesSearch(jobSearchFields(j, "Ann Lee"), q), q);
  }
  assert.equal(matchesSearch(jobSearchFields({ name: "Solo" }, null), "ann"), false);
});

test("expenses: vendor, category, job, item text and amount", () => {
  const r = {
    merchant_name: "Home Depot",
    tax_category: "Supplies",
    job_name: "Kitchen reno",
    total_amount: 45.5,
    items: [{ name: "Drywall screws" }],
  };
  for (const q of ["depot", "supplies", "kitchen", "screws", "45.50", "45.5"]) {
    assert.ok(matchesSearch(expenseSearchFields(r), q), q);
  }
  assert.equal(matchesSearch(expenseSearchFields({ ...r, items: null }), "screws"), false);
});

test("employees, hours, services: name (and job for hours)", () => {
  assert.ok(matchesSearch(nameSearchFields({ name: "Zoë Tremblay" }), "zoe"));
  const h = { employee: { name: "Zoë" }, job: { name: "Kitchen reno" } };
  assert.ok(matchesSearch(hourSearchFields(h), "zoe kitchen"));
  assert.equal(matchesSearch(hourSearchFields({}), "zoe"), false);
});

const SHARED_WIRING: [string, string][] = [
  ["src/components/clients/client-list.tsx", "clientSearchFields"],
  ["src/components/invoices/document-list.tsx", "documentSearchFields"],
  ["src/components/jobs/job-list.tsx", "jobSearchFields"],
  ["src/components/dashboard/expenses-body.tsx", "expenseSearchFields"],
  ["src/components/employees/employee-list.tsx", "nameSearchFields"],
  ["src/components/hours/hours-list.tsx", "hourSearchFields"],
  ["src/components/commission/service-list.tsx", "nameSearchFields"],
  ["src/components/commission/stylist-list.tsx", "nameSearchFields"],
  ["src/components/commission/product-list.tsx", "nameSearchFields"],
  ["src/components/invoices/line-item-list.tsx", "savedItemSearchFields"],
];

test("every list uses the shared search box, the shared matcher and its own field list", () => {
  for (const [file, fields] of SHARED_WIRING) {
    const src = readLf(file);
    assert.ok(src.includes('from "@/components/ui/list-search"') && src.includes("<ListSearch"), `${file}: ListSearch`);
    assert.ok(src.includes("searchList("), `${file}: searchList`);
    assert.ok(src.includes(fields), `${file}: ${fields}`);
    assert.ok(src.includes("<NoSearchResults") || src.includes("No results for"), `${file}: no-results state`);
  }
});

test("search text is its own state, never a default prop of a synced list", () => {
  for (const [file] of SHARED_WIRING) {
    const src = readLf(file);
    assert.ok(/const \[query, setQuery\] = useState\(""\)/.test(src), `${file}: own query state`);
    assert.ok(!/useSyncedState\([^)]*query/.test(src), file);
  }
});

test("the search box and matcher fetch nothing (filtering is on data already loaded)", () => {
  assert.ok(!readLf("src/components/ui/list-search.tsx").includes("fetch("));
  assert.ok(!readLf("src/lib/list-search.ts").includes("supabase"));
});

test("the document search runs inside the Type filter, never replacing it", () => {
  const src = readLf("src/components/invoices/document-list.tsx");
  assert.ok(/searchList\(\s*visibleDocuments/.test(src));
});
