/**
 * Records a phone-sized screen capture: sign in -> new estimate -> pick the
 * client -> two line items -> save -> convert to an invoice.
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL   app to record, default http://localhost:3000
 *   DEMO_EMAIL      demo user's email (password sign-in)
 *   DEMO_PASSWORD   demo user's password
 *   DEMO_HEADED     set to 1 to watch in a visible, slowed-down browser
 *   DEMO_CLIENT     name of the existing client to pick, default "Sample Client"
 *
 * The demo user must already have a client with the DEMO_CLIENT name and be on a
 * plan that allows estimates/invoices. This writes a real estimate and a real
 * invoice to whichever database the app points at (local dev and production
 * share one Supabase project) - use the demo account and delete them after.
 *
 * Run:  npm run record:demo
 * Out:  scripts/record-demo/out/estimate-to-invoice.webm
 */
import fs from "node:fs";
import path from "node:path";
import {
  caption,
  clickWithCursor,
  installOverlay,
  launchBrowser,
  newPhoneContext,
  pause,
  pickOption,
  requireEnv,
  typeWithCursor,
} from "./helpers.ts";

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CLIENT = process.env.DEMO_CLIENT || "Sample Client";

const OUT_DIR = path.join(import.meta.dirname, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw");
const OUT_FILE = path.join(OUT_DIR, "estimate-to-invoice.webm");

const LINES = [
  {
    name: "Interior painting",
    description: "Interior painting, 2 rooms",
    qty: "2",
    unit: "day",
    price: "450",
  },
  {
    name: "Paint and supplies",
    description: "Two coats, drop cloths and trim",
    qty: "1",
    unit: "each",
    price: "180",
  },
];

async function main() {
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const browser = await launchBrowser();
  const context = await newPhoneContext(browser, RAW_DIR);
  await installOverlay(context);
  // The app reads a "theme" localStorage key before first paint.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "light");
    } catch {}
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  // --- Sign in (not captioned: the story starts after login) ---
  await page.goto(`${BASE_URL}/auth`);
  await clickWithCursor(page, page.getByRole("tab", { name: "Password" }));
  // #pw-email / #pw-password: the Magic Link tab has a second "Email" field.
  await typeWithCursor(page, page.locator("#pw-email"), EMAIL);
  await typeWithCursor(page, page.locator("#pw-password"), PASSWORD);
  await clickWithCursor(page, page.getByRole("button", { name: "Sign in", exact: true }));
  await page.waitForURL(/\/dashboard/);
  await pause(page, 1200);

  // --- 1. Create an estimate ---
  await caption(page, "1. Create an estimate");
  const newEstimate = page.getByRole("link", { name: /new estimate/i }).first();
  if (await newEstimate.isVisible().catch(() => false)) {
    await clickWithCursor(page, newEstimate);
  } else {
    await page.goto(`${BASE_URL}/dashboard/estimates/new`);
  }
  await page.waitForURL(/\/dashboard\/estimates\/new/);
  await page.locator("#doc-client").waitFor();
  await pause(page, 800);

  // --- 2. Pick your client ---
  await caption(page, "2. Pick your client");
  await clickWithCursor(page, page.locator("#doc-client"));
  await pickOption(page, CLIENT);

  // --- 3. Add your work ---
  await caption(page, "3. Add your work");
  for (let i = 0; i < LINES.length; i++) {
    const line = LINES[i];
    if (i > 0) {
      await clickWithCursor(page, page.getByRole("button", { name: /add new line item/i }));
    }
    await typeWithCursor(page, page.getByLabel("Line name").nth(i), line.name);
    await typeWithCursor(page, page.getByLabel("Line description").nth(i), line.description);
    await typeWithCursor(page, page.getByPlaceholder("Qty").nth(i), line.qty, { clear: true });
    await clickWithCursor(page, page.getByRole("combobox", { name: "Unit" }).nth(i));
    await clickWithCursor(page, page.getByRole("option", { name: line.unit, exact: true }));
    await typeWithCursor(page, page.getByPlaceholder("Price").nth(i), line.price, { clear: true });
  }
  await pause(page, 600);

  await clickWithCursor(page, page.getByRole("button", { name: /^create estimate$/i }));
  await page.waitForURL(/\/dashboard\/estimates\/(?!new)[^/]+$/);
  await pause(page, 1200);

  // --- 4. Turn it into an invoice ---
  await caption(page, "4. Turn it into an invoice");
  await clickWithCursor(page, page.getByRole("button", { name: /convert to invoice/i }));
  await page.waitForURL(/\/dashboard\/invoices\/[^/]+$/);
  await pause(page, 2500);

  const video = page.video();
  await context.close(); // flushes the video
  await video?.saveAs(OUT_FILE);
  await browser.close();
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  console.log(`Saved ${OUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
