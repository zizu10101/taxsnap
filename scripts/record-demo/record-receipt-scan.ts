/**
 * Records a phone-sized screen capture (~35-50 s): sign in -> Scan Receipt > Upload Receipt with
 * a fake receipt image (assets/receipt-sample.png, made by make-receipt.ts) -> the AI reads it
 * -> merchant, total, tax and category are shown filled in -> Approve & Save -> the new expense
 * and the HST Return Helper on the dashboard. Afterwards an unrecorded second session deletes
 * the expense.
 *
 * COST: this makes ONE real Gemini scan against whichever app DEMO_BASE_URL points at - about
 * a cent. It also counts toward the demo account's scan allowance.
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL   app to record, default http://localhost:3000
 *   DEMO_EMAIL      demo user's email (password sign-in)
 *   DEMO_PASSWORD   demo user's password
 *   DEMO_HEADED     set to 1 to watch in a visible, slowed-down browser
 *   DEMO_DEBUG      set to 1 to log viewport/scale/overflow diagnostics after each step
 *
 * The upload uses the real "Upload Receipt" menu item (the camera option is never touched): the
 * click opens the file chooser, which Playwright answers with the sample image; if no chooser
 * appears the hidden upload input is fed directly. The sample is generated on the first run
 * (npm run record:demo:make-receipt does it by hand). Fictional data only.
 *
 * This writes a real expense (and its image) to whichever database the app points at (local dev
 * and production share one Supabase project) - use the demo account. Cleanup deletes the expense
 * and, with it, its stored image. If the run fails AFTER the scan but BEFORE Approve & Save, the
 * scanned image stays in the private receipts storage bucket with no expense pointing at it: the
 * app has no screen to remove it, so that one file would have to be deleted in Supabase Storage.
 *
 * Run:  npm run record:demo:receipt
 * Out:  scripts/record-demo/out/record-receipt-scan.webm
 */
import { spawnSync } from "node:child_process";
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
  pause,
  requireEnv,
  runDemo,
  signIn,
} from "./helpers.ts";

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CREDS = { baseUrl: BASE_URL, email: EMAIL, password: PASSWORD };

const HERE = import.meta.dirname;
const OUT_DIR = path.join(HERE, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw-receipt");
const OUT_FILE = path.join(OUT_DIR, "record-receipt-scan.webm");
const RECEIPT_PNG = path.join(HERE, "assets", "receipt-sample.png");
const RECEIPT_JSON = path.join(HERE, "assets", "receipt-sample.json");

if (!fs.existsSync(RECEIPT_PNG) || !fs.existsSync(RECEIPT_JSON)) {
  console.log("No sample receipt yet - generating it.");
  const made = spawnSync(process.execPath, [path.join(HERE, "make-receipt.ts")], { stdio: "inherit" });
  if (made.status !== 0) {
    console.error("Could not generate the sample receipt (npm run record:demo:make-receipt).");
    process.exit(1);
  }
}
const EXPECTED: { merchant: string; subtotal: number; tax: number; total: number } = JSON.parse(
  fs.readFileSync(RECEIPT_JSON, "utf8"),
);

async function record(browser: Browser, tracker: CreatedTracker) {
  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context);
  try {
    await signIn(page, CREDS, true); // lands on the dashboard, where the Scan Receipt button is
    await page.waitForLoadState("networkidle").catch(() => {});
    await pause(page, 1000);

    // --- 1. Snap or upload a receipt ---
    await caption(page, "1. Snap or upload a receipt");
    await clickWithCursor(page, page.getByRole("button", { name: /scan receipt/i }).first());
    const uploadItem = page.getByRole("menuitem", { name: /upload receipt/i });
    const chooser = page.waitForEvent("filechooser", { timeout: 6000 });
    chooser.catch(() => {}); // handled below; never leave it unhandled
    await clickWithCursor(page, uploadItem);
    try {
      await (await chooser).setFiles(RECEIPT_PNG);
    } catch {
      // No chooser opened: feed the hidden library input (the one without `capture`) directly.
      await page.locator('input[type="file"]:not([capture])').first().setInputFiles(RECEIPT_PNG);
    }

    // --- 2. AI reads it ---
    await caption(page, "2. AI reads it");
    const reviewTitle = page.getByText("Review extracted data");
    await reviewTitle.waitFor({ timeout: 90_000 }); // upload + one Gemini call
    await debugStep(page, "review dialog");
    await pause(page, 800);

    // --- 3. Merchant, tax and category filled in ---
    await caption(page, "3. Merchant, tax and category filled in");
    const dialog = page.getByRole("dialog");
    const fields = [
      dialog.locator("#merchant_name"),
      dialog.locator("#total_amount"),
      dialog.locator("#tax_amount"),
      dialog.locator("#tax_category"),
    ];
    for (const field of fields) {
      await moveTo(page, field);
      await pause(page, 700);
    }
    const read = {
      merchant: await dialog.locator("#merchant_name").inputValue(),
      total: Number(await dialog.locator("#total_amount").inputValue()),
      tax: Number(await dialog.locator("#tax_amount").inputValue()),
    };
    console.log(`AI read: ${read.merchant}, total ${read.total}, tax ${read.tax} (expected ${EXPECTED.merchant}, ${EXPECTED.total}, ${EXPECTED.tax})`);
    if (!/maple/i.test(read.merchant) || Math.abs(read.total - EXPECTED.total) > 0.01 || Math.abs(read.tax - EXPECTED.tax) > 0.01) {
      // Not fatal (the expense is still saved and then cleaned up), but the video would show a misread.
      console.warn("WARNING: the AI's read does not match the sample receipt. Run again before using this video.");
    }

    // --- 4. Saved, and counted in your HST ---
    await caption(page, "4. Saved, and counted in your HST");
    await clickWithCursor(page, dialog.getByRole("button", { name: /^(approve & save|save anyway)$/i }));
    await dialog.waitFor({ state: "hidden" });
    const saved = page.getByText(/maple hardware/i).first();
    await saved.waitFor();
    await moveTo(page, saved);
    await pause(page, 1500);
    const hst = page.locator('[data-slot="card"]').filter({ hasText: "Ontario HST Return Helper" });
    if (await hst.isVisible().catch(() => false)) {
      await clickWithCursor(page, hst.getByText("Ontario HST Return Helper"));
      const itc = hst.getByText("Line 106").first();
      await itc.waitFor();
      await moveTo(page, itc);
      await debugStep(page, "HST card");
    }
    await pause(page, 2500);

    await tracker.expectCount("expense", 1);
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
