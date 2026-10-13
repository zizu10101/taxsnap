/**
 * Records a phone-sized screen capture (~35-50 s): sign in -> new estimate with two line
 * items -> Send > Copy link (the real share-link call, whose response gives the signing URL)
 * -> in the SAME page, open that public signing URL as the client would, read the estimate,
 * type a name, tick "I agree" and Sign & Submit -> back to the owner's estimate, now showing
 * "Signed by ..." -> open the invoice. Afterwards an unrecorded second session deletes the
 * estimate and the invoice made from it.
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL            app to record, default http://localhost:3000
 *   DEMO_EMAIL               demo user's email (password sign-in)
 *   DEMO_PASSWORD            demo user's password
 *   DEMO_CLIENT              name of the existing client to pick, default "Sample Client"
 *   DEMO_HEADED              set to 1 to watch in a visible, slowed-down browser
 *   DEMO_DEBUG               set to 1 to log viewport/scale/overflow diagnostics after each step
 *   DEMO_ESIGN_ALLOW_EMAIL   set to 1 to allow the run when DEMO_CLIENT has an email address (see below)
 *
 * READ THIS FIRST: signing an estimate makes the app convert it to an invoice by itself and, if
 * the client has an email address, EMAIL them that invoice (a real email, from the live app).
 * So DEMO_CLIENT should have no email on file. The script looks the client up and stops before
 * signing if it has one, unless DEMO_ESIGN_ALLOW_EMAIL=1.
 *
 * The signature control is the real one: type your full name, tick "I agree to this estimate",
 * Sign & Submit (it is not a drawn signature). Because signing already converts the estimate,
 * there is nothing left to click for "Convert to Invoice": the owner view shows "Signed by ..."
 * and a View Invoice button, which the recording opens. (If the app ever did not convert, the
 * script clicks Convert to Invoice instead.)
 *
 * This writes a real estimate, signature and invoice to whichever database the app points at
 * (local dev and production share one Supabase project) - use the demo account. Cleanup deletes
 * the converted invoice first, then the estimate; if anything can't be deleted you get a warning
 * naming it and the reason. Nothing else is created (no payments, jobs or files).
 *
 * Run:  npm run record:demo:esign
 * Out:  scripts/record-demo/out/record-esign.webm
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright";
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

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CLIENT = process.env.DEMO_CLIENT || "Sample Client";
const CREDS = { baseUrl: BASE_URL, email: EMAIL, password: PASSWORD };

const OUT_DIR = path.join(import.meta.dirname, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw-esign");
const OUT_FILE = path.join(OUT_DIR, "record-esign.webm");

const LINES = [
  { name: "Fence repair", price: "850" },
  { name: "Gate hardware", price: "140" },
];

/** Glide to something only if it is on the page; never fails the run. */
async function glideIfThere(page: Page, target: Locator) {
  if (await target.first().isVisible().catch(() => false)) await moveTo(page, target.first());
}

async function record(browser: Browser, tracker: CreatedTracker) {
  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context);
  // "Copy link" writes the link to the clipboard; headless Chromium refuses that without permission.
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE_URL }).catch(() => {});
  try {
    await signIn(page, CREDS, true);
    await pause(page, 1000);

    // Stop BEFORE anything is signed if the client would be emailed.
    const clientsRes = await page.request.get(`${BASE_URL}/api/clients`);
    const clients: { name: string; email: string | null }[] = (await clientsRes.json()).clients ?? [];
    const client = clients.find((c) => c.name === CLIENT);
    if (!client) throw new Error(`No client named "${CLIENT}" in the demo account.`);
    if (client.email?.trim() && process.env.DEMO_ESIGN_ALLOW_EMAIL !== "1") {
      throw new Error(
        `"${CLIENT}" has an email address. Signing would make the app email them a real invoice. Use a client without an email, or set DEMO_ESIGN_ALLOW_EMAIL=1.`,
      );
    }

    // --- 1. Create your estimate ---
    await caption(page, "1. Create your estimate");
    const newEstimate = page.getByRole("link", { name: /new estimate/i }).first();
    if (await newEstimate.isVisible().catch(() => false)) {
      await clickWithCursor(page, newEstimate);
    } else {
      await page.goto(`${BASE_URL}/dashboard/estimates/new`);
    }
    await page.waitForURL(/\/dashboard\/estimates\/new/);
    await page.locator("#doc-client").waitFor();
    await clickWithCursor(page, page.locator("#doc-client"));
    await pickOption(page, CLIENT);
    for (let i = 0; i < LINES.length; i++) {
      if (i > 0) {
        await clickWithCursor(page, page.getByRole("button", { name: /add new line item/i }));
      }
      await typeWithCursor(page, page.getByLabel("Line name").nth(i), LINES[i].name);
      await typeWithCursor(page, page.getByPlaceholder("Price").nth(i), LINES[i].price, { clear: true });
    }
    await debugStep(page, "estimate form");
    await clickWithCursor(page, page.getByRole("button", { name: /^create estimate$/i }));
    await page.waitForURL(/\/dashboard\/estimates\/(?!new)[^/]+$/);
    tracker.addFromUrl(page.url());
    const ownerUrl = page.url();
    await page.getByRole("button", { name: "Send", exact: true }).waitFor();
    await debugStep(page, "estimate page");
    await pause(page, 1000);

    // --- 2. Send the link ---
    await caption(page, "2. Send the link");
    const shareResponse = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/api\/documents\/[^/]+\/share-link$/.test(new URL(r.url()).pathname),
    );
    shareResponse.catch(() => {}); // surfaced below; don't leave it unhandled if an earlier step throws
    await clickWithCursor(page, page.getByRole("button", { name: "Send", exact: true }));
    await clickWithCursor(page, page.getByRole("menuitem", { name: "Copy link" }));
    const shared = await (await shareResponse).json();
    if (typeof shared.url !== "string") throw new Error(`The share-link call gave no URL: ${JSON.stringify(shared)}`);
    // The app builds the link from NEXT_PUBLIC_APP_URL (maybe the live site); open the same token on the app being recorded.
    const signUrl = `${BASE_URL}${new URL(shared.url).pathname}`;
    await pause(page, 1500);

    // --- 3. Your client signs on their phone (same page, same context) ---
    await caption(page, "3. Your client signs on their phone");
    await page.goto(signUrl);
    await page.locator("#signer-name").waitFor();
    await debugStep(page, "signing page");
    await pause(page, 1500); // the estimate, as the client sees it
    await glideIfThere(page, page.getByText(/^total$/i));
    await pause(page, 1000);
    await typeWithCursor(page, page.locator("#signer-name"), CLIENT);
    await clickWithCursor(page, page.getByRole("checkbox").first());
    await clickWithCursor(page, page.getByRole("button", { name: /sign\s*&\s*submit/i }));
    await page.getByText(/thank you/i).first().waitFor();
    await moveTo(page, page.getByText(/thank you/i).first());
    await pause(page, 1800);

    // --- 4. Approved, now invoice it ---
    await caption(page, "4. Approved, now invoice it");
    await page.goto(ownerUrl);
    const signedBanner = page.getByText(/^Signed by/);
    await signedBanner.waitFor();
    await moveTo(page, signedBanner);
    await debugStep(page, "owner view, signed");
    await pause(page, 2000);

    // Signing already converted the estimate; otherwise convert it by hand.
    const viewInvoice = page.locator('a[href^="/dashboard/invoices/"]').filter({ hasText: /view invoice/i });
    const convert = page.getByRole("button", { name: /convert to invoice/i });
    await viewInvoice.or(convert).first().waitFor();
    if (await convert.isVisible().catch(() => false)) {
      await clickWithCursor(page, convert);
    } else {
      tracker.addFromUrl((await viewInvoice.first().getAttribute("href")) ?? "");
      await clickWithCursor(page, viewInvoice.first());
    }
    await page.waitForURL(/\/dashboard\/invoices\/[^/]+$/);
    tracker.addFromUrl(page.url());
    await pause(page, 2500);

    await tracker.expectCount("estimate", 1);
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
