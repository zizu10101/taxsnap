import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOW_TO_STEPS, HOW_TO_SUMMARY, HOW_TO_TABS } from "./how-to-content.ts";
import {
  howThisWorksStorageKey,
  readChoice,
  resetChoiceMemoryForTests,
  resolveOpen,
  subscribeChoice,
  writeChoice,
} from "./how-this-works.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

beforeEach(() => resetChoiceMemoryForTests());

// ------------------------------------------------------------------ content

test("every tab has 3 or 4 short steps, and the list of tabs is the list in the content file", () => {
  assert.deepEqual([...HOW_TO_TABS].sort(), Object.keys(HOW_TO_STEPS).sort());
  assert.deepEqual([...HOW_TO_TABS], ["invoices", "estimates", "jobs", "clients", "expenses", "reports"]);
  for (const tab of HOW_TO_TABS) {
    const steps = HOW_TO_STEPS[tab];
    assert.ok(steps.length >= 3 && steps.length <= 4, `${tab} has ${steps.length} steps`);
    for (const step of steps) {
      const words = step.trim().split(/\s+/).length;
      assert.ok(words <= 15, `${tab}: ${words} words: ${step}`);
      assert.ok(step.length > 10);
    }
  }
});

test("no step mentions a price, a plan, a usage cap, the statement import or the accountant tools", () => {
  const all = [HOW_TO_SUMMARY, ...HOW_TO_TABS.flatMap((t) => HOW_TO_STEPS[t])].join("\n");
  assert.doesNotMatch(all, /\$|\bCA\b|\bprice|\bpricing|\bper (month|year)|\bmonthly\b|\byearly\b|\bannual/i);
  assert.doesNotMatch(all, /\b(free|pro|plus|basic|premium|upgrade|plan|plans|limit|limits|cap|capped|quota)\b/i);
  assert.doesNotMatch(all, /\bstatements?\b|\baccountants?\b|\bbank\b/i);
  assert.doesNotMatch(all, /https?:|www\.|video|watch|\.ca\b|\.com\b/i);
});

test("steps use the button labels the screens really have", () => {
  const sources = [
    "../components/invoices/document-list.tsx", // New {label}
    "../components/invoices/document-editor.tsx", // Add New Line Item, Create {label}
    "../components/invoices/send-document-menu.tsx", // Send
    "../components/invoices/payment-form.tsx", // Record Payment
    "../components/invoices/document-detail.tsx", // Convert to Invoice
    "../components/jobs/job-list.tsx", // New job
    "../components/jobs/new-job-dialog.tsx", // Job name
    "../components/clients/client-list.tsx", // New client, Import clients
    "../components/clients/new-client-dialog.tsx", // Name
    "../components/dashboard/upload-receipt.tsx", // Upload Receipt, Review extracted data, Approve & Save
    "../components/dashboard/expenses-body.tsx", // Add Expense, From Template
    "../components/reports/reports-view.tsx", // P&L, Job Summary, Export CSV
  ]
    .map(read)
    .join("\n");
  for (const label of [
    "Add New Line Item",
    "Record Payment",
    "Convert to Invoice",
    "New job",
    "Job name",
    "New client",
    "Import clients",
    "Upload Receipt",
    "Review extracted data",
    "Approve & Save",
    "Add Expense",
    "From Template",
    "Job Summary",
    "Export CSV",
    "P&L",
  ]) {
    assert.ok(sources.includes(label), `no screen has "${label}"`);
  }
  assert.match(sources, /New \{label\}/);
  assert.match(sources, /Create \$\{?label\}?|`Create \$\{label\}`/);
  assert.match(sources, /Revenue/);
});

// ------------------------------------------------------------------ open-by-default rule

test("open by default only when empty and never touched; otherwise the stored choice wins", () => {
  assert.equal(resolveOpen({ empty: true, stored: null }), true);
  assert.equal(resolveOpen({ empty: false, stored: null }), false);
  assert.equal(resolveOpen({ empty: true, stored: "closed" }), false, "closed by the person, stays closed while empty");
  assert.equal(resolveOpen({ empty: true, stored: "open" }), true);
  assert.equal(resolveOpen({ empty: false, stored: "open" }), true, "opened by the person, stays open once there are records");
  assert.equal(resolveOpen({ empty: false, stored: "closed" }), false);
});

test("the choice is stored per tab and per user", () => {
  const a = howThisWorksStorageKey("invoices", "user-1");
  assert.notEqual(a, howThisWorksStorageKey("estimates", "user-1"));
  assert.notEqual(a, howThisWorksStorageKey("invoices", "user-2"));
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(readChoice(a, storage), null);
  writeChoice(a, "closed", storage);
  assert.equal(store.get(a), "closed");
  resetChoiceMemoryForTests();
  assert.equal(readChoice(a, storage), "closed", "read back from storage");
  assert.equal(readChoice(howThisWorksStorageKey("invoices", "user-2"), storage), null);
  store.set(a, "garbage");
  resetChoiceMemoryForTests();
  assert.equal(readChoice(a, storage), null, "an unknown stored value counts as never touched");
});

test("localStorage that throws never breaks reading, writing or toggling", () => {
  const throwing = {
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  };
  const key = howThisWorksStorageKey("jobs", "u");
  assert.equal(readChoice(key, throwing), null);
  let notified = 0;
  const off = subscribeChoice(() => notified++);
  assert.doesNotThrow(() => writeChoice(key, "open", throwing));
  assert.equal(notified, 1, "the component is told so it re-renders");
  assert.equal(readChoice(key, throwing), "open", "kept in memory for this visit");
  writeChoice(key, "closed", throwing);
  assert.equal(readChoice(key, throwing), "closed");
  off();
  // no storage at all (server, or the accessor threw)
  resetChoiceMemoryForTests();
  assert.equal(readChoice(key, null), null);
  assert.doesNotThrow(() => writeChoice(key, "open", null));
  assert.equal(readChoice(key, null), "open");
});

// ------------------------------------------------------------------ the component and its placement

test("the component is a real button with aria-expanded and aria-controls, and only touches storage through the helper", () => {
  const src = read("../components/ui/how-this-works.tsx");
  assert.match(src, /<button\s+type="button"/);
  assert.match(src, /aria-expanded=\{open\}/);
  assert.match(src, /aria-controls=\{panelId\}/);
  assert.match(src, /focus-visible:ring/);
  assert.match(src, /hidden=\{!open\}/);
  assert.doesNotMatch(src, /localStorage|sessionStorage/, "all storage access goes through lib/how-this-works.ts (try/catch)");
  assert.match(src, /\(\) => SERVER/, "the server render never reads storage");
  assert.doesNotMatch(src, /bg-primary|variant="default"/, "quiet: no filled button");
});

test("it is on the six tabs, and not on Settings, Admin or anything allowlisted", () => {
  const dash = "../app/(app)/dashboard/";
  for (const [file, tab] of [
    ["invoices/page.tsx", "invoices"],
    ["estimates/page.tsx", "estimates"],
    ["jobs/page.tsx", "jobs"],
    ["clients/page.tsx", "clients"],
    ["expenses/page.tsx", "expenses"],
    ["reports/page.tsx", "reports"],
  ]) {
    assert.match(read(dash + file), new RegExp(`<HowThisWorks tab="${tab}" userId=\\{user\\.id\\}`), file);
  }
  for (const file of [
    "settings/page.tsx",
    "../../admin/layout.tsx",
    "expenses/statements/page.tsx",
    "expenses/statements/[id]/page.tsx",
    "../../../components/dashboard/statement-import-button.tsx",
    "../../../components/dashboard/statements-list.tsx",
  ]) {
    try {
      assert.doesNotMatch(read(dash + file), /HowThisWorks/, file);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  // Reports shows it only with the real report, not on the locked page
  assert.match(read(dash + "reports/page.tsx"), /isPro && initialData && initialJobs && <HowThisWorks/);
});
