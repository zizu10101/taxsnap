/**
 * Records a phone-sized screen capture (~35-45 s): sign in -> new invoice with one line
 * item -> a $500 deposit -> the status turns Partial -> "Collect remaining balance" -> Paid.
 * Afterwards an unrecorded second session deletes the demo invoice (and its payments) again.
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
 * allows invoices. This writes a real invoice and two real payments to whichever database the
 * app points at (local dev and production share one Supabase project) - use the demo account.
 * The cleanup step removes both payments, sets the invoice back to Draft and deletes it; if
 * anything can't be deleted you get a warning naming it.
 *
 * Run:  npm run record:demo:payment
 * Out:  scripts/record-demo/out/record-payment.webm
 */
import fs from "node:fs";
import path from "node:path";
import {
  caption,
  clickWithCursor,
  CreatedTracker,
  debugStep,
  moveTo,
  newRecordingPage,
  pause,
  pickOption,
  requireEnv,
  runDemo,
  signIn,
  typeWithCursor,
} from "./helpers.ts";
import type { Browser } from "playwright";

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CLIENT = process.env.DEMO_CLIENT || "Sample Client";
const CREDS = { baseUrl: BASE_URL, email: EMAIL, password: PASSWORD };

const OUT_DIR = path.join(import.meta.dirname, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw-payment");
const OUT_FILE = path.join(OUT_DIR, "record-payment.webm");

const LINE_NAME = "Bathroom repaint";
const LINE_PRICE = "2000"; // + 13% HST = $2,260.00, so the deposit leaves $1,760.00
const DEPOSIT = "500";
const METHOD = "E-transfer";

async function record(browser: Browser, tracker: CreatedTracker) {
  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context);
  try {
    await signIn(page, CREDS, true);
    await pause(page, 1000);

    // --- 1. Open your invoice (create it, land on its page) ---
    await caption(page, "1. Open your invoice");
    const newInvoice = page.getByRole("link", { name: /new invoice/i }).first();
    if (await newInvoice.isVisible().catch(() => false)) {
      await clickWithCursor(page, newInvoice);
    } else {
      await page.goto(`${BASE_URL}/dashboard/invoices/new`);
    }
    await page.waitForURL(/\/dashboard\/invoices\/new/);
    await page.locator("#doc-client").waitFor();
    await clickWithCursor(page, page.locator("#doc-client"));
    await pickOption(page, CLIENT);
    await typeWithCursor(page, page.getByLabel("Line name").first(), LINE_NAME);
    await typeWithCursor(page, page.getByPlaceholder("Price").first(), LINE_PRICE, { clear: true });
    await debugStep(page, "invoice form");
    await clickWithCursor(page, page.getByRole("button", { name: /^create invoice$/i }));
    await page.waitForURL(/\/dashboard\/invoices\/(?!new)[^/]+$/);
    tracker.addFromUrl(page.url());
    await page.getByText("Payment History").first().waitFor();
    await debugStep(page, "invoice page");
    await pause(page, 1200);

    // --- 2. Record a deposit ---
    await caption(page, "2. Record a deposit");
    await typeWithCursor(page, page.locator("#payment-amount"), DEPOSIT, { clear: true });
    // "Method" is a free-text field (no list to pick from): type it like a user would.
    await typeWithCursor(page, page.locator("#payment-method"), METHOD);
    await clickWithCursor(page, page.getByRole("button", { name: /^record payment$/i }));
    const partial = page.getByText(/^partial$/i).first();
    await partial.waitFor();
    await page.getByRole("button", { name: /collect remaining balance/i }).waitFor();
    await debugStep(page, "after deposit");
    await moveTo(page, partial); // scrolls back up to the status pill
    await pause(page, 1500);

    // --- 3. Collect the remaining balance ---
    await caption(page, "3. Collect the remaining balance");
    await clickWithCursor(page, page.getByRole("button", { name: /collect remaining balance/i }));
    await typeWithCursor(page, page.locator("#payment-method"), METHOD);
    await pause(page, 600);
    await clickWithCursor(page, page.getByRole("button", { name: /^record payment$/i }));

    // --- 4. Paid in full ---
    await caption(page, "4. Paid in full, and your HST is counted");
    const paid = page.getByText(/^paid$/i).first();
    await paid.waitFor();
    await moveTo(page, paid);
    await debugStep(page, "paid");
    await pause(page, 2500);

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
