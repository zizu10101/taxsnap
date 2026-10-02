import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getActiveNavKey,
  getNavItems,
  HIDEABLE_NAV_KEYS,
  sanitizeHiddenNavKeys,
  splitMobileNav,
} from "./nav-config.ts";

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

const keysOf = (opts: Parameters<typeof getNavItems>[0]) => getNavItems(opts).map((i) => i.key);

test("hiding is cosmetic: hidden tabs just drop out of the menu, nothing else changes", () => {
  const all = keysOf({ businessType: "general", isPro: true });
  const some = keysOf({ businessType: "general", isPro: true, hiddenKeys: ["jobs", "reports"] });
  assert.deepEqual(some, all.filter((k) => k !== "jobs" && k !== "reports"));
});

test("Dashboard can never be hidden, even if asked", () => {
  const keys = keysOf({ businessType: "general", isPro: true, hiddenKeys: ["dashboard", "estimates"] });
  assert.ok(keys.includes("dashboard"));
  assert.ok(!keys.includes("estimates"));
});

test("a hidden tab stays visible while you are on its page", () => {
  const keys = keysOf({ businessType: "general", isPro: true, hiddenKeys: ["clients"], keepKey: "clients" });
  assert.ok(keys.includes("clients"));
});

test("a salon menu is never affected by hidden keys", () => {
  assert.deepEqual(
    keysOf({ businessType: "salon", isPro: true, hiddenKeys: ["jobs", "commission"] }),
    ["dashboard", "commission"],
  );
});

test("hiding a mobile primary tab promotes the next visible tab into the freed slot", () => {
  const items = getNavItems({ businessType: "general", isPro: true, hiddenKeys: ["estimates"] });
  const { primary, overflow } = splitMobileNav(items);
  assert.deepEqual(primary.map((i) => i.key), ["dashboard", "invoices", "jobs", "employees"]);
  assert.ok(!overflow.some((i) => i.key === "employees"));
});

test("sanitizeHiddenNavKeys keeps only known keys, de-duped, in nav order", () => {
  assert.deepEqual(sanitizeHiddenNavKeys(["reports", "bogus", "jobs", "jobs", 5, null, "dashboard"]), [
    "jobs",
    "reports",
  ]);
  assert.deepEqual(sanitizeHiddenNavKeys("jobs"), []);
  assert.deepEqual(sanitizeHiddenNavKeys(undefined), []);
});

test("every hideable key is a real nav tab, and Dashboard is not hideable", () => {
  const real = new Set(keysOf({ businessType: "general", isPro: true }));
  for (const k of HIDEABLE_NAV_KEYS) assert.ok(real.has(k), k);
  assert.ok(!(HIDEABLE_NAV_KEYS as readonly string[]).includes("dashboard"));
});
