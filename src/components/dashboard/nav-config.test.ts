import { test } from "node:test";
import assert from "node:assert/strict";
import { getActiveNavKey, getNavItems, splitMobileNav } from "./nav-config.ts";

test("Employees is its own tab and owns the Employees and Hours pages", () => {
  assert.equal(getActiveNavKey("/dashboard/employees"), "employees");
  assert.equal(getActiveNavKey("/dashboard/hours"), "employees");
});

test("Jobs only lights up for the Jobs pages now", () => {
  assert.equal(getActiveNavKey("/dashboard/jobs"), "jobs");
  assert.equal(getActiveNavKey("/dashboard/jobs/abc-123"), "jobs");
});

test("other tabs and the dashboard are unaffected", () => {
  assert.equal(getActiveNavKey("/dashboard"), "dashboard");
  assert.equal(getActiveNavKey("/dashboard/invoices/new"), "invoices");
  assert.equal(getActiveNavKey("/dashboard/clients"), "clients");
  assert.equal(getActiveNavKey("/dashboard/progress-billing"), "progress-billing");
  assert.equal(getActiveNavKey("/dashboard/settings"), undefined);
});

test("general accounts get Employees right after Jobs; salons don't get it", () => {
  const general = getNavItems({ businessType: "general", isPro: false }).map((i) => i.key);
  assert.deepEqual(general.slice(0, 5), ["dashboard", "estimates", "invoices", "jobs", "employees"]);
  const salon = getNavItems({ businessType: "salon", isPro: true }).map((i) => i.key);
  assert.equal(salon.includes("employees"), false);
});

test("Employees is available on every plan (capped, not Pro-only)", () => {
  for (const isPro of [false, true]) {
    const keys = getNavItems({ businessType: "general", isPro }).map((i) => i.key);
    assert.ok(keys.includes("employees"), `isPro=${isPro}`);
  }
});

test("mobile: the 4 primary slots are unchanged, Employees goes to More", () => {
  const { primary, overflow } = splitMobileNav(getNavItems({ businessType: "general", isPro: true }));
  assert.deepEqual(primary.map((i) => i.key), ["dashboard", "estimates", "invoices", "jobs"]);
  assert.ok(overflow.some((i) => i.key === "employees"));
});

test("every item's route maps back to its own key", () => {
  for (const item of getNavItems({ businessType: "general", isPro: true })) {
    assert.equal(getActiveNavKey(item.href), item.key, item.href);
  }
});

test("Reports is its own Pro tab right after Overview, in the mobile More sheet", () => {
  assert.equal(getActiveNavKey("/dashboard/reports"), "reports");
  const pro = getNavItems({ businessType: "general", isPro: true }).map((i) => i.key);
  assert.equal(pro[pro.indexOf("overview") + 1], "reports");
  const free = getNavItems({ businessType: "general", isPro: false }).map((i) => i.key);
  assert.equal(free.includes("reports"), false);
  const salon = getNavItems({ businessType: "salon", isPro: true }).map((i) => i.key);
  assert.equal(salon.includes("reports"), false);
  const { overflow } = splitMobileNav(getNavItems({ businessType: "general", isPro: true }));
  assert.ok(overflow.some((i) => i.key === "reports"));
});
