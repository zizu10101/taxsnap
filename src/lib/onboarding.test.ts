import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  GOALS,
  checklistItems,
  checklistVisible,
  AFTER_ONBOARDING,
  nextChecklistItem,
  parseGoals,
  storedGoals,
  goalsFor,
  isGoal,
  isProvinceCode,
  taxRateForProvince,
  SAMPLE_CLIENT_NAME,
  SAMPLE_JOB_NAME,
} from "./onboarding.ts";
import { sampleBlockMessage } from "./sample-data.ts";
import { recordActivation } from "./activation.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("only Ontario has a calculated tax rate; every other province is explicitly unsupported", () => {
  assert.equal(taxRateForProvince("ON"), 0.13);
  for (const p of ["AB", "BC", "QC", "NS", "NB", "PE", "NL", "SK", "MB", "YT", "NT", "NU"]) {
    assert.equal(taxRateForProvince(p), null, p);
  }
  assert.equal(isProvinceCode("ON"), true);
  assert.equal(isProvinceCode("TX"), false);
  assert.equal(isProvinceCode(undefined), false);
});

test("goals: everyone gets the three general goals, a salon also gets the Register goal", () => {
  assert.deepEqual(goalsFor("general").map((g) => g.value), ["invoices", "expenses", "job_profit"]);
  assert.deepEqual(goalsFor("salon").map((g) => g.value), ["invoices", "expenses", "job_profit", "salon"]);
  assert.deepEqual(goalsFor("general", true).map((g) => g.value), ["invoices", "expenses", "job_profit", "salon"]);
  assert.equal(isGoal("job_profit"), true);
  assert.equal(isGoal("everything"), false);
  assert.equal(GOALS.length, 4);
});

test("a selection must be a non-empty list of offered goals; order is kept, repeats dropped", () => {
  const general = goalsFor("general").map((g) => g.value);
  assert.deepEqual(parseGoals(["expenses", "invoices"], general), ["expenses", "invoices"]);
  assert.deepEqual(parseGoals(["invoices", "invoices"], general), ["invoices"]);
  assert.equal(parseGoals([], general), null);
  assert.equal(parseGoals(undefined, general), null);
  assert.equal(parseGoals("invoices", general), null);
  assert.equal(parseGoals(["nonsense"], general), null);
  assert.equal(parseGoals(["salon"], general), null, "salon goal is not offered to a general account");
  assert.deepEqual(parseGoals(["salon", "expenses"], goalsFor("salon").map((g) => g.value)), ["salon", "expenses"]);
});

test("stored goals: the list wins, an old single goal still works, junk is ignored", () => {
  assert.deepEqual(storedGoals(["job_profit", "invoices"], "expenses"), ["job_profit", "invoices"]);
  assert.deepEqual(storedGoals([], "expenses"), ["expenses"]);
  assert.deepEqual(storedGoals(null, "salon"), ["salon"]);
  assert.deepEqual(storedGoals(["x"], null), []);
  assert.deepEqual(storedGoals(undefined, undefined), []);
});

test("onboarding always ends on the dashboard, never a blank form", () => {
  assert.equal(AFTER_ONBOARDING, "/dashboard");
  assert.match(read("../app/api/onboarding/complete/route.ts"), /next: AFTER_ONBOARDING/);
  const flow = read("../app/onboarding/onboarding-flow.tsx");
  assert.match(flow, /router\.push\(AFTER_ONBOARDING\)/);
  assert.doesNotMatch(flow, /invoices\/new|estimates\/new/);
});

const none = { hasClient: false, invoiceSent: false, receiptSaved: false };
const keys = (goals: Parameters<typeof checklistItems>[0]) => checklistItems(goals, none).map((i) => i.key);

test("the checklist follows the picked goals, in the order picked, without repeats", () => {
  assert.deepEqual(keys(["invoices"]), ["client", "invoice"]);
  assert.deepEqual(keys(["expenses"]), ["receipt"]);
  assert.deepEqual(keys(["job_profit"]), ["job", "receipt"]);
  assert.deepEqual(keys(["expenses", "invoices"]), ["receipt", "client", "invoice"]);
  assert.deepEqual(keys(["job_profit", "expenses", "invoices"]), ["job", "receipt", "client", "invoice"]);
  assert.deepEqual(keys(["salon", "expenses"]), ["service", "stylist", "receipt"]);
  assert.deepEqual(keys([]), ["client", "invoice", "receipt"], "no goals reads as the basics");
  for (const g of GOALS) {
    assert.ok(!checklistItems([g.value], none).some((i) => /payment/i.test(i.label)), g.value);
  }
});

test("progress, the highlighted next item, and when the card hides", () => {
  const partial = checklistItems(["invoices", "expenses"], { ...none, hasClient: true });
  assert.deepEqual(partial.map((i) => i.done), [true, false, false]);
  assert.equal(nextChecklistItem(partial)?.key, "invoice");
  assert.equal(checklistVisible(partial, null), true);
  assert.equal(checklistVisible(partial, "2026-10-20T00:00:00Z"), false);
  const finished = checklistItems(["invoices", "expenses"], { hasClient: true, invoiceSent: true, receiptSaved: true });
  assert.equal(nextChecklistItem(finished), null);
  assert.equal(checklistVisible(finished, null), false);
  assert.equal(checklistItems(["job_profit"], { ...none, hasJob: true })[0].done, true);
});

// A recording fake of the Supabase client for the two server helpers.
function fakeDb(rows: { sampleClient?: boolean; sampleJob?: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const guards: string[] = [];
  const db = {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return chain;
        },
        eq: () => chain,
        is: (col: string, v: unknown) => {
          guards.push(`${col}:${String(v)}`);
          return Promise.resolve({ error: null });
        },
        maybeSingle: async () => ({
          data: table === "clients" ? (rows.sampleClient ? { id: "c" } : null) : rows.sampleJob ? { id: "j" } : null,
        }),
      };
      void q;
      return chain;
    },
  };
  return { db: db as never, updates, guards };
}

test("sample data is refused as a client, a job id or the reserved job name", async () => {
  assert.ok(await sampleBlockMessage(fakeDb({ sampleClient: true }).db, "u", { clientId: "c" }));
  assert.ok(await sampleBlockMessage(fakeDb({ sampleJob: true }).db, "u", { jobId: "j" }));
  assert.ok(await sampleBlockMessage(fakeDb({}).db, "u", { jobName: ` ${SAMPLE_JOB_NAME.toUpperCase()} ` }));
  assert.equal(await sampleBlockMessage(fakeDb({}).db, "u", { clientId: "x", jobId: "y", jobName: "Kitchen" }), null);
  assert.equal(await sampleBlockMessage(fakeDb({}).db, "u", {}), null);
  assert.match(SAMPLE_CLIENT_NAME, /demo/);
  assert.match(SAMPLE_JOB_NAME, /demo/);
});

test("activation is written once: only the matching column, and only while it is still null", async () => {
  const a = fakeDb({});
  await recordActivation(a.db, "u", "first_invoice_sent_at");
  assert.deepEqual(Object.keys(a.updates[0]), ["first_invoice_sent_at"]);
  assert.deepEqual(a.guards, ["first_invoice_sent_at:null"]);
  const b = fakeDb({});
  await recordActivation(b.db, "u", "first_receipt_saved_at");
  assert.deepEqual(Object.keys(b.updates[0]), ["first_receipt_saved_at"]);
  assert.deepEqual(b.guards, ["first_receipt_saved_at:null"]);
});

test("activation is recorded where an invoice is sent and a receipt is saved", () => {
  assert.match(read("../app/api/documents/[id]/send-email/route.ts"), /first_invoice_sent_at/);
  assert.match(read("../app/api/documents/[id]/share-link/route.ts"), /first_invoice_sent_at/);
  assert.match(read("../app/api/documents/[id]/mark-sent/route.ts"), /first_invoice_sent_at/);
  assert.match(read("../app/api/documents/[id]/route.ts"), /first_invoice_sent_at/);
  assert.match(read("../app/api/receipts/route.ts"), /first_receipt_saved_at/);
});

test("the sample rows are refused by every route that builds records, and never count toward caps", () => {
  for (const f of [
    "../app/api/documents/route.ts",
    "../app/api/documents/[id]/route.ts",
    "../app/api/receipts/route.ts",
    "../app/api/receipts/[id]/route.ts",
    "../app/api/hours/route.ts",
  ]) {
    assert.match(read(f), /sampleBlockMessage\(/, f);
  }
  assert.match(read("./plan-limits.ts"), /is_sample/);
  assert.match(read("./reports-query.ts"), /is_sample/);
});

test("sample data never touches a client-facing surface", () => {
  for (const f of [
    "./invoice-pdf.ts",
    "./email.ts",
    "../components/public/document-paper.tsx",
    "../app/invoice/[token]/page.tsx",
    "./csv.ts",
    "./hst.ts",
    "./client-portal.ts",
  ]) {
    assert.doesNotMatch(read(f), /is_sample/, f);
  }
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

test("onboarding shows no upgrade prompt, and the retired steps are gone", () => {
  const dir = new URL("../app/onboarding", import.meta.url);
  const files = walk(dir.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  assert.ok(files.length > 0);
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /upgrade-prompt|UpgradeCard|\/billing|FREE_LIMIT_REACHED|Upgrade to/i, f);
  }
  assert.ok(!files.some((f) => /pin-step|stylists-step|services-step|staff-step|logo-step|pro-lock/.test(f)));
  assert.doesNotMatch(read("../components/dashboard/getting-started.tsx"), /upgrade-prompt|UpgradeCard|\/billing/);
});

// ---------------------------------------------------- pickers and the usage bar

const dash = "../app/(app)/dashboard/";

test("sample clients and jobs are filtered out of every builder's picker source", () => {
  const pages = [
    "estimates/new/page.tsx",
    "estimates/[id]/edit/page.tsx",
    "estimates/[id]/page.tsx",
    "estimates/page.tsx",
    "invoices/new/page.tsx",
    "invoices/[id]/edit/page.tsx",
    "invoices/[id]/page.tsx",
    "invoices/page.tsx",
    "hours/page.tsx",
    "progress-billing/page.tsx",
    "progress-billing/[jobId]/page.tsx",
    "expenses/page.tsx",
    "page.tsx",
  ];
  for (const p of pages) {
    const src = read(dash + p);
    assert.match(src, /\.eq\("is_sample", false\)/, p);
  }
  // The builders' client AND job queries are both filtered where a page loads both.
  for (const p of ["invoices/new/page.tsx", "estimates/new/page.tsx", "progress-billing/page.tsx"]) {
    const src = read(dash + p);
    assert.equal((src.match(/\.eq\("is_sample", false\)/g) ?? []).length >= 2, true, p);
  }
});

test("the Clients and Jobs lists still load sample rows (they show the Sample badge)", () => {
  assert.doesNotMatch(read(dash + "clients/page.tsx"), /is_sample/);
  assert.doesNotMatch(read(dash + "jobs/page.tsx").replace(/supabase\.from\("clients"\)[^\n]*\n/, ""), /is_sample/);
  assert.match(read("../components/clients/client-list.tsx"), /client\.is_sample/);
  assert.match(read("../components/jobs/job-list.tsx"), /job\.is_sample/);
});

test("job detail keeps the sample job's own customer but offers no sample in a picker", () => {
  const src = read("../components/jobs/job-detail.tsx");
  assert.match(src, /pickerClients = clients\.filter\(\(c\) => !c\.is_sample\)/);
  assert.match(src, /pickerJobs = jobs\.filter\(\(j\) => !j\.is_sample\)/);
  assert.match(src, /!c\.is_sample \|\| c\.id === job\.client_id/);
  assert.match(src, /clients=\{pickerClients\}/);
  assert.match(src, /jobs=\{pickerJobs\}/);
});

test("the usage bars count the same rows the cap check counts (no sample)", () => {
  assert.match(read("../components/clients/client-list.tsx"), /current=\{clients\.filter\(\(c\) => !c\.is_sample\)\.length\}/);
  assert.match(read("../components/jobs/job-list.tsx"), /current=\{jobs\.filter\(\(j\) => !j\.is_sample\)\.length\}/);
  // Invoices/Estimates pages hand DocumentList only non-sample clients, so its bar matches too.
  assert.match(read(dash + "invoices/page.tsx"), /\.eq\("is_sample", false\)/);
  assert.match(read("./plan-limits.ts"), /resource === "clients" \|\| resource === "jobs"\) query = query\.eq\("is_sample"/);
});

test("photos: the API refuses the sample job on upload, move and bulk move", () => {
  for (const f of [
    "../app/api/job-photos/route.ts",
    "../app/api/job-photos/bulk/route.ts",
    "../app/api/job-photos/[id]/route.ts",
  ]) {
    const src = read(f);
    assert.match(src, /sampleBlockMessage\(supabase, user\.id, \{ jobId: ref\.jobId \}\)/, f);
    assert.match(src, /status: 400/, f);
  }
});

test("photos: no photo job picker offers the sample job", () => {
  assert.match(read(dash + "photos/page.tsx"), /\.eq\("is_sample", false\)/);
  assert.match(read(dash + "jobs/[id]/page.tsx"), /filter\(\(j\) => !j\.is_sample\)/);
  const gallery = read("../components/photos/photo-gallery.tsx");
  assert.equal((gallery.match(/\.filter\(\(j\) => !j\.is_sample\)/g) ?? []).length, 2);
});

test("step 1 saves to the profile fields Settings and the invoice already use", () => {
  const flow = read("../app/onboarding/onboarding-flow.tsx");
  assert.match(flow, /\/api\/profile\/business/);
  for (const field of ["business_name", "business_phone", "business_address", "business_number"]) {
    assert.match(flow, new RegExp(field), field);
  }
  assert.match(flow, /BusinessLogoUpload/, "reuses the existing logo component");
  assert.doesNotMatch(flow, /\/api\/profile\/logo/, "no second logo upload path");
  const route = read("../app/api/profile/business/route.ts");
  assert.match(route, /business_number/);
  assert.match(read("../app/onboarding/page.tsx"), /business_number/);
});

test("the HST/BN number is printed on the invoice PDF and the public page, and editable in Settings", () => {
  assert.match(read("./invoice-pdf.ts"), /HST\/BN: \$\{business\.hstNumber\}/);
  assert.match(read("../components/public/document-paper.tsx"), /HST\/BN: \{business\.hstNumber\}/);
  assert.match(read("../components/invoices/business-profile-dialog.tsx"), /business_number/);
  assert.match(read("../app/(app)/dashboard/settings/page.tsx"), /<BusinessProfileCard/);
  assert.match(read("../app/invoice/[token]/page.tsx"), /hstNumber: profile\?\.business_number/);
  for (const f of ["../app/(app)/dashboard/invoices/[id]/page.tsx", "../app/(app)/dashboard/invoices/page.tsx"]) {
    assert.match(read(f), /business_number/, f);
  }
});

test("0066 keeps the old goal column, backfills the list, and has a rollback", () => {
  const up = readFileSync(new URL("../../supabase/migrations/0066_onboarding_goals_business_number.sql", import.meta.url), "utf8");
  assert.match(up, /onboarding_goals text\[\]/);
  assert.match(up, /<@ array\['invoices','expenses','job_profit','salon'\]/);
  assert.match(up, /set onboarding_goals = array\[onboarding_goal\]/);
  assert.doesNotMatch(up, /drop column/i);
  const down = readFileSync(new URL("../../supabase/rollbacks/0066_onboarding_goals_business_number_rollback.sql", import.meta.url), "utf8");
  assert.match(down, /drop column if exists onboarding_goals/);
  assert.doesNotMatch(down, /drop column if exists onboarding_goal,/);
  assert.match(read("../app/api/onboarding/complete/route.ts"), /onboarding_goal: goals\[0\]/);
});

test("the client and accountant portal PDFs carry the HST/BN line end to end", () => {
  // 1. The loaders select the column and map it onto the business object the PDF reads.
  for (const f of ["./client-portal-server.ts", "./accountant-portal-server.ts"]) {
    const src = read(f);
    assert.match(src, /\.select\("[^"]*business_address, business_number[^"]*"\)/, f);
    assert.match(src, /hstNumber: profile\?\.business_number \?\? null/, f);
    assert.match(src, /hstNumber\?: string \| null/, f);
  }
  // 2. The routes behind "Download PDF" hand that business object over untouched.
  for (const f of [
    "../app/api/client-portal/documents/[id]/route.ts",
    "../app/api/accountant-portal/documents/[id]/route.ts",
  ]) {
    assert.match(read(f), /NextResponse\.json\(\{ document: detail\.document, business, logoUrl \}\)/, f);
  }
  // 3. The browser passes data.business to the same generator, which prints the line.
  assert.match(read("../components/client-portal/client-pdf-button.tsx"), /generateDocumentPdf\(data\.document, data\.business,/);
  assert.match(read("./invoice-pdf.ts"), /business\.hstNumber \? `HST\/BN: \$\{business\.hstNumber\}` : null/);
  // 4. The owner-only business columns the portal must not gain stay out of its select.
  assert.doesNotMatch(read("./client-portal-server.ts"), /subscription_status|stripe_|onboarding_/);
});
