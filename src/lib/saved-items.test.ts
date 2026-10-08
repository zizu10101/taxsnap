import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterSavedItems,
  insertLine,
  lineFromSavedItem,
  savedItemQuantity,
  type SavedItemLike,
} from "./saved-items.ts";

const ITEMS: SavedItemLike[] = [
  { id: "1", description: "Interior paint, per room", unit_price: 450, quantity: 2 },
  { id: "2", description: "Drywall patch", unit_price: 85.5, quantity: 1 },
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

test("picking an item fills description, quantity AND price", () => {
  assert.deepEqual(lineFromSavedItem(ITEMS[0]), {
    description: "Interior paint, per room",
    quantity: 2,
    unit_price: 450,
  });
});

test("a missing, zero, negative or junk stored quantity reads as 1", () => {
  assert.equal(savedItemQuantity({ quantity: undefined }), 1);
  assert.equal(savedItemQuantity({ quantity: null }), 1);
  assert.equal(savedItemQuantity({ quantity: 0 }), 1);
  assert.equal(savedItemQuantity({ quantity: -3 }), 1);
  assert.equal(savedItemQuantity({ quantity: Number.NaN }), 1);
  assert.equal(savedItemQuantity({ quantity: 2.5 }), 2.5);
  assert.equal(lineFromSavedItem(ITEMS[2]).quantity, 1);
});

test("insertLine reuses the first blank line, otherwise appends", () => {
  const filled = { description: "Drywall patch", quantity: 3, unit_price: 85.5 };
  const withBlank = [
    { description: "Paint", quantity: 1, unit_price: 10 },
    { description: "  ", quantity: 1, unit_price: 0 },
  ];
  assert.deepEqual(insertLine(withBlank, filled), [withBlank[0], filled]);
  const noBlank = [withBlank[0]];
  assert.deepEqual(insertLine(noBlank, filled), [withBlank[0], filled]);
});
