import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MENU_KEYS_BY_GOAL,
  MENU_TAB_DESCRIPTIONS,
  MENU_TAB_KEYS,
  PRO_ONLY_MENU_KEYS,
  hiddenForGoals,
  hiddenFromVisible,
  manageableMenuKeys,
  visibleFromHidden,
  visibleKeysForGoals,
} from "./menu-customize.ts";
import { GOALS } from "./onboarding.ts";
import { HIDEABLE_NAV_KEYS, sanitizeHiddenNavKeys } from "../components/dashboard/nav-config.ts";

test("the panel's tabs are exactly the hideable nav tabs, same order", () => {
  assert.deepEqual([...MENU_TAB_KEYS], [...HIDEABLE_NAV_KEYS]);
});

test("every tab has a one-line description, every goal a mapping", () => {
  for (const k of MENU_TAB_KEYS) assert.ok(MENU_TAB_DESCRIPTIONS[k].length > 0, k);
  for (const g of GOALS) assert.ok(g.value in MENU_KEYS_BY_GOAL, g.value);
});

test("Dashboard, Photos and Settings are never managed", () => {
  for (const k of ["dashboard", "photos", "settings"]) {
    assert.ok(!(MENU_TAB_KEYS as readonly string[]).includes(k), k);
  }
});

test("a free account is never offered a Pro tab", () => {
  const free = manageableMenuKeys(false);
  for (const k of PRO_ONLY_MENU_KEYS) assert.ok(!free.includes(k), k);
  assert.deepEqual(manageableMenuKeys(true), [...MENU_TAB_KEYS]);
});

test("goal mapping: invoices", () => {
  assert.deepEqual(visibleKeysForGoals(["invoices"], true), ["estimates", "invoices", "clients"]);
});

test("goal mapping: expenses", () => {
  assert.deepEqual(visibleKeysForGoals(["expenses"], true), ["expenses", "overview"]);
});

test("goal mapping: job profit", () => {
  assert.deepEqual(visibleKeysForGoals(["job_profit"], true), [
    "invoices",
    "jobs",
    "employees",
    "clients",
    "expenses",
    "progress-billing",
    "reports",
  ]);
});

test("several goals give the union, in menu order, without repeats", () => {
  assert.deepEqual(visibleKeysForGoals(["expenses", "invoices"], true), [
    "estimates",
    "invoices",
    "clients",
    "expenses",
    "overview",
  ]);
});

test("a free account's prefill leaves out Pro tabs", () => {
  assert.deepEqual(visibleKeysForGoals(["job_profit"], false), [
    "invoices",
    "jobs",
    "employees",
    "clients",
    "expenses",
  ]);
  assert.deepEqual(visibleKeysForGoals(["expenses"], false), ["expenses"]);
});

test("no goals, or only salon, shows every tab for the plan", () => {
  assert.deepEqual(visibleKeysForGoals([], true), [...MENU_TAB_KEYS]);
  assert.deepEqual(visibleKeysForGoals(["salon"], false), manageableMenuKeys(false));
});

test("saving the goal prefill hides the rest, and never hides a Pro tab for a free account", () => {
  assert.deepEqual(hiddenForGoals(["invoices"], false), ["jobs", "employees", "expenses"]);
  assert.deepEqual(hiddenForGoals(["invoices"], true), [
    "jobs",
    "employees",
    "expenses",
    "progress-billing",
    "overview",
    "reports",
  ]);
});

test("existing users (nothing hidden) see every tab", () => {
  assert.deepEqual(visibleFromHidden([], true), [...MENU_TAB_KEYS]);
  assert.deepEqual(visibleFromHidden([], false), manageableMenuKeys(false));
});

test("hidden <-> visible round-trips for a Pro account", () => {
  const hidden = ["jobs", "reports"];
  assert.deepEqual(hiddenFromVisible(visibleFromHidden(hidden, true), true), hidden);
});

test("a free account keeps a Pro tab's stored state untouched", () => {
  assert.deepEqual(hiddenFromVisible(["invoices"], false, ["reports"]), [
    "estimates",
    "jobs",
    "employees",
    "clients",
    "expenses",
    "reports",
  ]);
  assert.deepEqual(hiddenFromVisible([...manageableMenuKeys(false)], false, []), []);
});

test("Show everything stores an empty hidden list", () => {
  assert.deepEqual(hiddenFromVisible([...MENU_TAB_KEYS], true, ["jobs"]), []);
});

test("unknown or duplicate keys are dropped; output is accepted by the nav API's sanitizer", () => {
  const out = hiddenFromVisible(["jobs", "jobs", "bogus", "dashboard"], true);
  assert.deepEqual(out, sanitizeHiddenNavKeys(out));
  assert.ok(!out.includes("jobs"));
});
