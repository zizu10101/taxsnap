import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checklistStorageKey,
  checklistSummary,
  checklistView,
  resolveChecklistExpanded,
} from "./checklist-view.ts";
import { readChoice, resetChoiceMemoryForTests, writeChoice } from "./how-this-works.ts";

const base = { total: 5, done: 2, dismissedAt: null, expanded: true };

test("storage key is per user", () => {
  assert.notEqual(checklistStorageKey("a"), checklistStorageKey("b"));
});

test("expanded by default; only an explicit collapse collapses", () => {
  assert.equal(resolveChecklistExpanded(null), true);
  assert.equal(resolveChecklistExpanded("open"), true);
  assert.equal(resolveChecklistExpanded("closed"), false);
});

test("in progress: expanded or collapsed follows the remembered choice", () => {
  assert.equal(checklistView(base), "expanded");
  assert.equal(checklistView({ ...base, expanded: false }), "collapsed");
});

test("collapsed summary line shows progress", () => {
  assert.equal(checklistSummary(2, 5), "Getting started · 2 of 5 done");
});

test("all done shows 'all set' whether or not it was collapsed", () => {
  assert.equal(checklistView({ ...base, done: 5 }), "all-set");
  assert.equal(checklistView({ ...base, done: 5, expanded: false }), "all-set");
});

test("dismissed stays hidden in every state, including accounts that used the old X", () => {
  const d = "2026-10-20T00:00:00Z";
  for (const done of [0, 2, 5]) {
    for (const expanded of [true, false]) {
      assert.equal(checklistView({ ...base, done, expanded, dismissedAt: d }), "hidden");
    }
  }
});

test("no items means nothing to show", () => {
  assert.equal(checklistView({ ...base, total: 0, done: 0 }), "hidden");
});

test("the choice is remembered per user and survives a broken storage", () => {
  resetChoiceMemoryForTests();
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  writeChoice(checklistStorageKey("u1"), "closed", storage);
  assert.equal(readChoice(checklistStorageKey("u1"), storage), "closed");
  assert.equal(readChoice(checklistStorageKey("u2"), storage), null);
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("full");
    },
  };
  writeChoice(checklistStorageKey("u3"), "closed", broken);
  assert.equal(readChoice(checklistStorageKey("u3"), broken), "closed");
});
