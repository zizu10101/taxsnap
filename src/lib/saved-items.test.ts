import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterSavedItems,
  insertLine,
  lineFromSavedItem,
  insertedLineIndex,
  sortSavedItems,
  type SavedItemLike,
} from "./saved-items.ts";

const ITEMS: SavedItemLike[] = [
  { id: "1", description: "Interior paint, per room", unit_price: 450 },
  { id: "2", description: "Drywall patch", unit_price: 85.5 },
  { id: "3", description: "Trim - per metre", unit_price: 6 },
  { id: "4", description: "Exterior PAINT, 2 coats", unit_price: 900 },
];
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("an empty or blank query returns every item in the original order", () => {
  assert.deepEqual(ids(filterSavedItems(ITEMS, "")), ["1", "2", "3", "4"]);
  assert.deepEqual(ids(filterSavedItems(ITEMS, "   ")), ["1", "2", "3", "4"]);
});

test("matches as you type, ignoring case", () => {
  assert.deepEqual(ids(filterSavedItems(ITEMS, "p")), ["1", "2", "3", "4"]);
  assert.deepEqual(ids(filterSavedItems(ITEMS, "pai")), ["1", "4"]);
  assert.deepEqual(ids(filterSavedItems(ITEMS, "PAINT")), ["1", "4"]);
  assert.deepEqual(ids(filterSavedItems(ITEMS, "drywall")), ["2"]);
});

test("every word must match, in any order", () => {
  assert.deepEqual(ids(filterSavedItems(ITEMS, "paint room")), ["1"]);
  assert.deepEqual(ids(filterSavedItems(ITEMS, "room paint")), ["1"]);
  assert.deepEqual(ids(filterSavedItems(ITEMS, "paint patch")), []);
});

test("surrounding and repeated spaces don't matter; no match is an empty list", () => {
  assert.deepEqual(ids(filterSavedItems(ITEMS, "  trim   metre ")), ["3"]);
  assert.deepEqual(filterSavedItems(ITEMS, "zzz"), []);
});

test("searches the description only, not the price", () => {
  assert.deepEqual(filterSavedItems(ITEMS, "450"), []);
});

test("filtering doesn't change the list it was given", () => {
  const copy = [...ITEMS];
  filterSavedItems(ITEMS, "paint");
  assert.deepEqual(ITEMS, copy);
});

test("picking an item fills name, description, unit and price per unit, with quantity 1", () => {
  // an old item (no name): its description becomes the name, with an empty description
  assert.deepEqual(lineFromSavedItem(ITEMS[0]), {
    name: "Interior paint, per room",
    description: "",
    unit: "",
    quantity: 1,
    unit_price: 450,
  });
  // a new item keeps name, description, unit and price
  assert.deepEqual(
    lineFromSavedItem({ id: "9", name: "Crown moulding", description: "Primed MDF, 2 coats", unit: "linear ft", unit_price: 4.5 }),
    { name: "Crown moulding", description: "Primed MDF, 2 coats", unit: "linear ft", quantity: 1, unit_price: 4.5 },
  );
});

test("a stored quantity on an existing row is never recalled: the pick comes back with quantity 1", () => {
  // rows from before this change still hold line_items.quantity (migration 0059)
  for (const stored of [800, 6, 0.5, 0, -3, Number.NaN, null]) {
    const row = { id: "r", description: "Flooring", unit: "sq ft", unit_price: 5, quantity: stored };
    assert.equal(lineFromSavedItem(row).quantity, 1, String(stored));
  }
});

test("search looks at the name and the description", () => {
  const items: SavedItemLike[] = [
    { id: "a", name: "Crown moulding", description: "Primed MDF", unit_price: 1 },
    { id: "b", description: "Baseboard", unit_price: 1 },
  ];
  assert.deepEqual(ids(filterSavedItems(items, "crown")), ["a"]);
  assert.deepEqual(ids(filterSavedItems(items, "primed")), ["a"]);
  assert.deepEqual(ids(filterSavedItems(items, "baseboard")), ["b"]);
});

test("insertedLineIndex is the first blank line, otherwise the end (where focus goes)", () => {
  const lines = [{ name: "Paint" }, { name: "  " }, { name: "Trim" }];
  assert.equal(insertedLineIndex(lines), 1);
  assert.equal(insertedLineIndex([{ name: "A" }, { name: "B" }]), 2);
  assert.equal(insertedLineIndex([]), 0);
});

test("insertLine reuses the first blank line, otherwise appends", () => {
  const filled = { name: "Drywall patch", description: "", unit: "", quantity: 3, unit_price: 85.5 };
  const withBlank = [
    { name: "Paint", description: "", unit: "", quantity: 1, unit_price: 10 },
    // a line with only a description typed (no name) is still blank: the name is what makes a line
    { name: "  ", description: "notes", unit: "", quantity: 1, unit_price: 0 },
  ];
  assert.deepEqual(insertLine(withBlank, filled), [withBlank[0], filled]);
  const noBlank = [withBlank[0]];
  assert.deepEqual(insertLine(noBlank, filled), [withBlank[0], filled]);
});

test("saved items sort by name, an old item by its description, whatever the description column holds", () => {
  const items: SavedItemLike[] = [
    { id: "n1", name: "Trim", description: "", unit_price: 1 },
    { id: "old", description: "Drywall patch", unit_price: 1 },
    { id: "n2", name: "Paint", description: "", unit_price: 1 },
  ];
  assert.deepEqual(ids(sortSavedItems(items)), ["old", "n2", "n1"]);
  assert.deepEqual(ids(items), ["n1", "old", "n2"]); // the input is untouched
});

test("no query orders saved items by the description column; the list sources sort by name", () => {
  const lf = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
  const files = [
    "src/app/api/line-items/route.ts",
    "src/app/(app)/dashboard/line-items/page.tsx",
    "src/app/(app)/dashboard/estimates/new/page.tsx",
    "src/app/(app)/dashboard/estimates/[id]/edit/page.tsx",
    "src/app/(app)/dashboard/estimates/[id]/page.tsx",
    "src/app/(app)/dashboard/invoices/new/page.tsx",
    "src/app/(app)/dashboard/invoices/[id]/edit/page.tsx",
    "src/app/(app)/dashboard/invoices/[id]/page.tsx",
    "src/app/(app)/dashboard/jobs/[id]/page.tsx",
    "src/app/(app)/dashboard/progress-billing/page.tsx",
    "src/app/(app)/dashboard/progress-billing/[jobId]/page.tsx",
  ];
  for (const f of files) assert.ok(!lf(f).includes('.order("description"'), f);
  // the API and the management page return/seed name order; the pickers sort themselves
  assert.ok(lf("src/app/api/line-items/route.ts").includes("sortSavedItems(data"));
  assert.ok(lf("src/app/(app)/dashboard/line-items/page.tsx").includes("sortSavedItems(lineItems"));
  assert.ok(lf("src/components/invoices/saved-item-picker.tsx").includes("sortSavedItems(items)"));
});

test("nothing that fills a line reads a saved item's stored quantity; forms focus the quantity after a pick", () => {
  const lf = (p: string) => readFileSync(p, "utf8").split("\r\n").join("\n");
  assert.ok(!/savedItemQuantity|item\.quantity|saved\.quantity/.test(lf("src/lib/saved-items.ts")));
  assert.ok(!/savedItemQuantity/.test(lf("src/components/invoices/saved-item-picker.tsx")));
  assert.ok(!/savedItemQuantity|quantity/.test(lf("src/components/invoices/line-item-list.tsx")));
  for (const file of [
    "src/components/invoices/document-builder.tsx",
    "src/components/invoices/document-editor.tsx",
    "src/components/jobs/log-contract-change-dialog.tsx",
  ]) {
    assert.ok(lf(file).includes("focusLineQuantity("), file);
  }
  const focus = lf("src/lib/focus-line-quantity.ts");
  assert.ok(focus.includes("el.focus()") && focus.includes("el.select()"));
  assert.ok(lf("src/components/invoices/line-item-fields.tsx").includes("data-line-qty={index}"));
});
