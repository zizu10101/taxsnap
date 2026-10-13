/**
 * Records a phone-sized screen capture (~35-45 s): sign in -> create the job "Deck rebuild"
 * -> add two costs (Lumber 640.00, Hardware 85.50) through the manual expense form -> an
 * invoice for the job with a $2,500 payment -> the job's profit view. Afterwards an
 * unrecorded second session deletes everything the run created (invoice + payment, both
 * expenses, the job).
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL   app to record, default http://localhost:3000
 *   DEMO_EMAIL      demo user's email (password sign-in)
 *   DEMO_PASSWORD   demo user's password
 *   DEMO_CLIENT     name of the existing client to pick, default "Sample Client"
 *   DEMO_HEADED     set to 1 to watch in a visible, slowed-down browser
 *   DEMO_DEBUG      set to 1 to log viewport/scale/overflow diagnostics after each step
 *
 * The demo user must already have a client with the DEMO_CLIENT name and be on a plan that
 * allows jobs and invoices. This writes a real job, two real expenses, an invoice and a
 * payment to whichever database the app points at (local dev and production share one
 * Supabase project) - use the demo account. If cleanup can't delete something you get a
 * warning naming it.
 *
 * Run:  npm run record:demo:profit
 * Out:  scripts/record-demo/out/job-profit.webm
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser } from "playwright";
import {
  caption,
  clickWithCursor,
  CreatedTracker,
  debugStep,
  moveTo,
  newRecordingPage,
  openNav,
  pause,
  pickOption,
  requireEnv,
  runDemo,
  signIn,
  typeWithCursor,
} from "./helpers.ts";

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CLIENT = process.env.DEMO_CLIENT || "Sample Client";
const CREDS = { baseUrl: BASE_URL, email: EMAIL, password: PASSWORD };

const OUT_DIR = path.join(import.meta.dirname, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw-profit");
const OUT_FILE = path.join(OUT_DIR, "job-profit.webm");

const JOB_NAME = "Deck rebuild";
const EXPENSES = [
  { description: "Lumber", amount: "640.00" },
  { description: "Hardware", amount: "85.50" },
];
const COST_TOTAL_TEXT = "$725.50"; // 640.00 + 85.50, as the job page formats it
const INVOICE_LINE = "Deck rebuild, labour and materials";
const INVOICE_PRICE = "3000"; // + 13% HST = $3,390.00, so the $2,500 payment is a partial one
const PAYMENT = "2500";
const METHOD = "E-transfer";

async function record(browser: Browser, tracker: CreatedTracker) {
  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context);
  try {
    await signIn(page, CREDS, true);
    await pause(page, 1000);

    // --- 1. Create a job ---
    await caption(page, "1. Create a job");
    await openNav(page, BASE_URL, "/dashboard/jobs");
    await clickWithCursor(page, page.getByRole("button", { name: "New job" }).first());
    await typeWithCursor(page, page.locator("#job-name"), JOB_NAME);
    await clickWithCursor(page, page.locator("#job-customer"));
    await pickOption(page, CLIENT);
    await clickWithCursor(page, page.getByRole("button", { name: "Create job" }));
    // Creating a job already navigates to its page (NewJobDialog's onCreated does router.push).
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    tracker.addFromUrl(page.url());
    const jobUrl = page.url();
    const jobPath = new URL(jobUrl).pathname;
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await debugStep(page, "job page");
    await pause(page, 800);

    // --- 2. Add your costs (the manual expense form: no camera, no scan) ---
    await caption(page, "2. Add your costs");
    await openNav(page, BASE_URL, "/dashboard/expenses");
    for (const expense of EXPENSES) {
      await clickWithCursor(page, page.getByRole("button", { name: "Add Expense" }).first());
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      await typeWithCursor(page, dialog.locator("#expense-description"), expense.description);
      await typeWithCursor(page, dialog.locator("#expense-amount"), expense.amount, { clear: true });
      await clickWithCursor(page, dialog.locator("#expense-job"));
      await pickOption(page, JOB_NAME);
      await debugStep(page, `expense form (${expense.description})`);
      await clickWithCursor(page, dialog.getByRole("button", { name: "Save Expense" }));
      await dialog.waitFor({ state: "hidden" });
      await pause(page, 600);
    }

    // --- 3. Get paid: an invoice for the job, then a payment against it ---
    await caption(page, "3. Get paid");
    await page.goto(jobUrl);
    await clickWithCursor(page, page.getByRole("button", { name: /new invoice for this job/i }));
    const builder = page.getByRole("dialog");
    await builder.waitFor();
    // The job's customer may already be filled in; pick the client only if it is not.
    const clientTrigger = builder.locator("#doc-client");
    if (!(await clientTrigger.innerText()).includes(CLIENT)) {
      await clickWithCursor(page, clientTrigger);
      await pickOption(page, CLIENT);
    }
    await typeWithCursor(page, builder.getByLabel("Line name").first(), INVOICE_LINE);
    await typeWithCursor(page, builder.getByPlaceholder("Price").first(), INVOICE_PRICE, { clear: true });
    await debugStep(page, "invoice dialog");
    await clickWithCursor(page, builder.getByRole("button", { name: /^create invoice$/i }));
    await builder.waitFor({ state: "hidden" });

    // The job page re-reads after the save and lists the invoice: open it from there.
    await tracker.settle();
    const invoice = tracker.items.find((i) => i.kind === "invoice");
    if (!invoice) throw new Error("The invoice was created but its id was not captured.");
    const invoiceLink = page.locator(`a[href^="/dashboard/invoices/${invoice.id}"]`).first();
    await invoiceLink.waitFor();
    await clickWithCursor(page, invoiceLink);
    await page.waitForURL(new RegExp(`/dashboard/invoices/${invoice.id}`));
    await page.getByText("Payment History").first().waitFor();

    await typeWithCursor(page, page.locator("#payment-amount"), PAYMENT, { clear: true });
    await typeWithCursor(page, page.locator("#payment-method"), METHOD);
    await clickWithCursor(page, page.getByRole("button", { name: /^record payment$/i }));
    const partial = page.getByText(/^partial$/i).first();
    await partial.waitFor();
    await moveTo(page, partial);
    await debugStep(page, "after payment");
    await pause(page, 1000);

    // --- 4. See your real profit ---
    await caption(page, "4. See your real profit");
    const jobLink = page.locator(`a[href="${jobPath}"]`).first();
    if (await jobLink.isVisible().catch(() => false)) {
      await clickWithCursor(page, jobLink);
      await page.waitForURL(new RegExp(`${jobPath}$`));
    } else {
      await page.goto(jobUrl);
    }
    // Fails loudly (rather than recording a wrong picture) if the costs aren't counted.
    await page.getByText(COST_TOTAL_TEXT).first().waitFor();
    await moveTo(page, page.getByText("Revenue", { exact: true }));
    await debugStep(page, "profit view");
    await pause(page, 3500);

    await tracker.expectCount("job", 1);
    await tracker.expectCount("expense", EXPENSES.length);
    await tracker.expectCount("invoice", 1);
    const video = page.video();
    await context.close(); // flushes the video
    await video?.saveAs(OUT_FILE);
    console.log(`Saved ${OUT_FILE}`);
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }
}

runDemo(CREDS, record);
