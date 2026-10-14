/**
 * Records a phone-sized screen capture (~40-50 s), READ-ONLY: sign in -> Reports -> custom
 * date range June 1 to September 30 of this year -> Revenue (by client) -> Expenses by
 * category -> Group by Vendor -> the HST Return Helper on the dashboard. Each view holds for
 * 2 s. Nothing is created, so there is nothing to clean up.
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL   app to record, default http://localhost:3000
 *   DEMO_EMAIL      demo user's email (password sign-in)
 *   DEMO_PASSWORD   demo user's password
 *   DEMO_HEADED     set to 1 to watch in a visible, slowed-down browser
 *   DEMO_DEBUG      set to 1 to log viewport/scale/overflow diagnostics after each step
 *
 * Each view has its own date filter in the app (the P&L/Expenses pair share one, the Revenue
 * tab and the HST card each have their own), so the range is set in each, the way a user would.
 *
 * Export, import and accountant controls are never clicked, and are also HIDDEN while recording
 * (any short button/link whose text matches export|csv|quickbooks|import|accountant|bundle|
 * statements) so they do not appear in the video.
 *
 * Because this shows real data from the demo account, the run prints "Names on screen" for the
 * Revenue (clients), Expenses (categories and vendors) views, and warns if any visible text
 * mentions "statement". Read that output before publishing the video.
 *
 * Run:  npm run record:demo:reports
 * Out:  scripts/record-demo/out/record-reports.webm
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Locator, Page } from "playwright";
import {
  caption,
  clickWithCursor,
  CreatedTracker,
  debugStep,
  fillDate,
  hideControls,
  moveTo,
  newRecordingPage,
  openNav,
  pause,
  pickOption,
  requireEnv,
  runDemo,
  signIn,
} from "./helpers.ts";

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CREDS = { baseUrl: BASE_URL, email: EMAIL, password: PASSWORD };

const OUT_DIR = path.join(import.meta.dirname, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw-reports");
const OUT_FILE = path.join(OUT_DIR, "record-reports.webm");

const YEAR = new Date().getFullYear();
const RANGE_START = `${YEAR}-06-01`;
const RANGE_END = `${YEAR}-09-30`;
const HOLD_MS = 2000;

/** Print what the viewer will see, so the demo account can be checked without watching the video. */
async function logNames(page: Page, view: string, cells: Locator) {
  const names = (await cells.allInnerTexts().catch(() => [])).map((t) => t.trim().replace(/\s+/g, " ")).filter(Boolean);
  console.log(`Names on screen (${view}): ${names.length ? names.slice(0, 12).join(" | ") : "(none found)"}`);
}

async function warnIfMentionsStatements(page: Page, view: string) {
  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  if (/statement/i.test(text)) {
    console.warn(`WARNING (${view}): visible text on this view mentions "statement". Check the video before publishing it.`);
  }
}

/**
 * Wait until `rows` has rendered (the report's data has loaded), or stop with a clear message if the
 * view says it is empty. A heading renders before its data does, so waiting on a heading is not enough.
 */
async function waitForRows(page: Page, view: string, rows: Locator, emptyText: RegExp) {
  const empty = page.getByText(emptyText).first();
  const winner = await Promise.race([
    rows.first().waitFor({ timeout: 30_000 }).then(() => "rows" as const),
    empty.waitFor({ timeout: 30_000 }).then(() => "empty" as const),
  ]).catch(() => {
    throw new Error(`${view}: neither rows nor an empty message appeared within 30 s (still loading?).`);
  });
  if (winner === "empty") {
    throw new Error(`No ${view} in ${RANGE_START} to ${RANGE_END}: add some to the demo account, then record again.`);
  }
}

/** Open the Custom Range option of the date filter inside `scope` and set June 1 - Sept 30. */
async function setRange(page: Page, scope: Page | Locator) {
  await clickWithCursor(page, scope.getByRole("combobox").first());
  await pickOption(page, "Custom Range");
  await fillDate(page, scope.locator("#range-start"), RANGE_START);
  await fillDate(page, scope.locator("#range-end"), RANGE_END);
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function record(browser: Browser, tracker: CreatedTracker) {
  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context); // stays empty: nothing here creates anything
  await hideControls(context, /\b(export|csv|quickbooks|import|accountant|bundle|statements?)\b/i);
  try {
    await signIn(page, CREDS, true);
    await pause(page, 1000);

    // --- 1. Pick your dates ---
    await caption(page, "1. Pick your dates");
    await openNav(page, BASE_URL, "/dashboard/reports");
    await page.getByRole("combobox").first().waitFor();
    await setRange(page, page);
    await debugStep(page, "reports, P&L with range");
    await pause(page, HOLD_MS);

    // --- 2. Revenue by client ---
    await caption(page, "2. Revenue by client");
    await clickWithCursor(page, page.getByRole("button", { name: "Revenue", exact: true }));
    await page.getByRole("combobox").first().waitFor();
    await setRange(page, page); // the Revenue tab keeps its own range
    await page.getByRole("columnheader", { name: "Client" }).first().waitFor();
    const clientRows = page.locator("table").first().locator("tbody tr td:first-child");
    await waitForRows(page, "revenue", clientRows, /Nothing in this range/);
    await moveTo(page, page.getByRole("columnheader", { name: "Client" }).first());
    await debugStep(page, "revenue by client");
    await logNames(page, "Revenue, clients", clientRows);
    await warnIfMentionsStatements(page, "Revenue");
    await pause(page, HOLD_MS);

    // --- 3. Expenses by category or vendor ---
    await caption(page, "3. Expenses by category or vendor");
    await clickWithCursor(page, page.getByRole("button", { name: "Expenses", exact: true }));
    await page.getByText("Expenses by Category").first().waitFor();
    await moveTo(page, page.getByText("Expenses by Category").first());
    const expensesCard = page.locator('[data-slot="card"]').filter({ hasText: /Expenses by (Category|Vendor)/ });
    const expenseRows = expensesCard.locator("table tbody tr td:first-child");
    await waitForRows(page, "expenses", expenseRows, /No expenses in this range/);
    await debugStep(page, "expenses by category");
    await logNames(page, "Expenses, categories", expenseRows);
    await warnIfMentionsStatements(page, "Expenses by category");
    await pause(page, HOLD_MS);
    // The Group-by toggle has aria-pressed; the Vendor filter dropdown (aria-expanded) does not.
    await clickWithCursor(page, page.locator("button[aria-pressed]", { hasText: /^Vendor$/ }));
    await page.getByText("Expenses by Vendor").first().waitFor();
    await expensesCard.getByRole("columnheader", { name: "Vendor" }).first().waitFor();
    await waitForRows(page, "expenses", expenseRows, /No expenses in this range/);
    await debugStep(page, "expenses by vendor");
    await logNames(page, "Expenses, vendors", expenseRows);
    await warnIfMentionsStatements(page, "Expenses by vendor");
    await pause(page, HOLD_MS);

    // --- 4. Know your HST ---
    await caption(page, "4. Know your HST");
    await openNav(page, BASE_URL, "/dashboard");
    const hst = page.locator('[data-slot="card"]').filter({ hasText: "Ontario HST Return Helper" });
    await hst.waitFor();
    await clickWithCursor(page, hst.getByText("Ontario HST Return Helper"));
    await hst.getByRole("combobox").first().waitFor();
    await setRange(page, hst);
    await hst.getByText("Line 109").first().waitFor();
    await page.waitForLoadState("networkidle").catch(() => {});
    await moveTo(page, hst.getByText("Line 109").first());
    await debugStep(page, "HST summary");
    await warnIfMentionsStatements(page, "HST");
    await pause(page, HOLD_MS + 500);

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
