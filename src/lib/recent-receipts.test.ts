import { test } from "node:test";
import assert from "node:assert/strict";
import { pickRecentlyAdded, RECENT_RECEIPT_LIMIT } from "./recent-receipts.ts";

const SIGN_IN = "2026-10-01T12:00:00.000Z";

function r(id: string, created_at: string) {
  return { id, created_at };
}

test("only receipts created since the last sign-in, and not already visible", () => {
  const receipts = [
    r("old", "2026-09-30T08:00:00Z"), // before sign-in
    r("new-hidden", "2026-10-02T09:00:00Z"),
    r("new-visible", "2026-10-02T10:00:00Z"),
  ];
  const { items } = pickRecentlyAdded(receipts, new Set(["new-visible"]), SIGN_IN);
  assert.deepEqual(items.map((x) => x.id), ["new-hidden"]);
});

test("a receipt created exactly at sign-in counts", () => {
  const { items } = pickRecentlyAdded([r("a", SIGN_IN)], new Set(), SIGN_IN);
  assert.equal(items.length, 1);
});

test("newest first", () => {
  const receipts = [
    r("a", "2026-10-02T01:00:00Z"),
    r("c", "2026-10-02T03:00:00Z"),
    r("b", "2026-10-02T02:00:00Z"),
  ];
  const { items } = pickRecentlyAdded(receipts, new Set(), SIGN_IN);
  assert.deepEqual(items.map((x) => x.id), ["c", "b", "a"]);
});

test("capped, with the rest counted", () => {
  const receipts = Array.from({ length: RECENT_RECEIPT_LIMIT + 3 }, (_, i) =>
    r(`r${i}`, `2026-10-02T00:${String(i).padStart(2, "0")}:00Z`),
  );
  const { items, hiddenCount } = pickRecentlyAdded(receipts, new Set(), SIGN_IN);
  assert.equal(items.length, RECENT_RECEIPT_LIMIT);
  assert.equal(hiddenCount, 3);
});

test("no sign-in time (or a bad one) shows nothing", () => {
  const receipts = [r("a", "2026-10-02T01:00:00Z")];
  assert.deepEqual(pickRecentlyAdded(receipts, new Set(), null), { items: [], hiddenCount: 0 });
  assert.deepEqual(pickRecentlyAdded(receipts, new Set(), undefined), { items: [], hiddenCount: 0 });
  assert.deepEqual(pickRecentlyAdded(receipts, new Set(), "not a date"), { items: [], hiddenCount: 0 });
});

test("nothing hidden means nothing shown", () => {
  const receipts = [r("a", "2026-10-02T01:00:00Z")];
  assert.deepEqual(pickRecentlyAdded(receipts, new Set(["a"]), SIGN_IN), { items: [], hiddenCount: 0 });
});
