import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PLAN_LIMITS, limitReachedMessage, normalizeTier } from "./plan-limits.ts";
import { INVOICE_FOOTER_URL, showsInvoiceFooter } from "./invoice-footer.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("Free and Pro are the only plans, and the Free caps are unchanged", () => {
  assert.deepEqual(Object.keys(PLAN_LIMITS).sort(), ["free", "pro"]);
  assert.deepEqual(PLAN_LIMITS.free, {
    scansPerMonth: 5,
    invoicesPerMonth: 3,
    clients: 3,
    jobs: 1,
    lineItems: 1,
    expenseTemplates: 3,
    employees: 1,
    activeServices: 1,
    activeStylists: 1,
    activeProducts: 1,
    activeRenters: 1,
    manualSalesEntriesPerMonth: 3,
    statementImportsPerMonth: 1,
    photos: 10,
  });
});

test("a leftover 'basic' row (or anything unknown) is Free", () => {
  assert.equal(normalizeTier("basic"), "free");
  assert.equal(normalizeTier(null), "free");
  assert.equal(normalizeTier(undefined), "free");
  assert.equal(normalizeTier("pro"), "pro");
});

test("the cap message always points at Pro", () => {
  const msg = limitReachedMessage({ exceeded: true, limit: 3, current: 3, tier: "free" }, "client");
  assert.equal(msg, "Free accounts can have 3 clients. Upgrade to Pro to add more.");
});

test("the invoice footer: Free invoices only, never Pro, never estimates", () => {
  assert.equal(showsInvoiceFooter("free", "invoice"), true);
  assert.equal(showsInvoiceFooter("basic", "invoice"), true);
  assert.equal(showsInvoiceFooter(null, "invoice"), true);
  assert.equal(showsInvoiceFooter("pro", "invoice"), false);
  assert.equal(showsInvoiceFooter("free", "estimate"), false);
  assert.equal(INVOICE_FOOTER_URL, "https://gettaxsnap.ca/?src=invoice-footer");
});

test("the footer code never touches the owner-only internal notes", () => {
  const ownerOnly = new RegExp(["internal", "notes"].join("_"));
  for (const f of ["./invoice-footer.ts", "./email.ts", "../components/public/document-paper.tsx"]) {
    assert.doesNotMatch(read(f), ownerOnly, f);
  }
  assert.doesNotMatch(read("../app/invoice/[token]/page.tsx"), ownerOnly);
});

test("no Basic tier is left in the checkout, webhook or price config", () => {
  for (const f of [
    "./stripe.ts",
    "../app/api/stripe/checkout/route.ts",
    "../app/api/stripe/webhook/route.ts",
    "./admin-data.ts",
  ]) {
    assert.doesNotMatch(read(f), /BASIC_PRICE|STRIPE_PRICE_IDS\.basic|"basic"/, f);
  }
});

test("checkout uses Stripe Tax and the annual Pro price", () => {
  assert.match(read("./stripe-checkout.ts"), /automatic_tax:\s*\{\s*enabled:\s*true\s*\}/);
  assert.match(read("./stripe.ts"), /STRIPE_PRO_ANNUAL_PRICE_ID/);
});

test("Progress Billing is Pro-only on the server, not just hidden", () => {
  for (const f of [
    "../app/api/jobs/[id]/contract-changes/route.ts",
    "../app/api/jobs/[id]/contract-changes/[changeId]/route.ts",
    "../app/api/jobs/[id]/allocate-payment/route.ts",
  ]) {
    assert.match(read(f), /requireProUser\(\)/, f);
    assert.doesNotMatch(read(f), /requireUser\(\)/, f);
  }
  assert.match(read("../app/api/documents/route.ts"), /is_progress_draw && !\(await isProUser/);
  assert.match(read("../app/api/jobs/[id]/route.ts"), /isProUser\(supabase, user\.id\)/);
});

test("every route that can create a job from a typed name checks the job cap", () => {
  for (const f of [
    "../app/api/documents/route.ts",
    "../app/api/hours/route.ts",
    "../app/api/receipts/route.ts",
    "../app/api/receipts/[id]/route.ts",
  ]) {
    assert.match(read(f), /newJobCapMessage\(/, f);
  }
});

test("a receipt at the job cap is still saved, unlinked, with a flag - never a failed save", () => {
  for (const f of ["../app/api/receipts/route.ts", "../app/api/receipts/[id]/route.ts"]) {
    const src = read(f);
    assert.match(src, /job_not_linked: true/, f);
    assert.match(src, /job_name: savedJobName/, f);
    assert.doesNotMatch(src, /jobCapMessage\) \{\s*return NextResponse/, f);
  }
  for (const f of ["../components/dashboard/upload-receipt.tsx", "../components/dashboard/receipt-detail-dialog.tsx"]) {
    assert.match(read(f), /Receipt saved\. Upgrade to Pro to track more jobs/, f);
  }
});

test("the accountant bundle and commission export are locked for Free in the UI", () => {
  const list = read("../components/dashboard/receipts-list.tsx");
  assert.match(list, /if \(!isPro\) \{\s*showUpgradePrompt/);
  assert.match(read("../components/commission/commission-reports.tsx"), /showUpgradePrompt\("Export and share/);
});
