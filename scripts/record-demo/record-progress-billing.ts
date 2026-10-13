/**
 * Records a phone-sized screen capture (~40-50 s): sign in -> Progress Billing > Start with a
 * new job and a $10,000 contract -> draw 1 (30% = $3,000) -> draw 2 (40% = $4,000) -> the job's
 * card (contract, invoiced, received, remaining, the draws) -> the Invoices list with its
 * "Draw N" badges. Afterwards an unrecorded second session deletes both draws and the job.
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL   app to record, default http://localhost:3000
 *   DEMO_EMAIL      demo user's email (password sign-in)
 *   DEMO_PASSWORD   demo user's password
 *   DEMO_CLIENT     name of the existing client to pick, default "Sample Client"
 *   DEMO_HEADED     set to 1 to watch in a visible, slowed-down browser
 *   DEMO_DEBUG      set to 1 to log viewport/scale/overflow diagnostics after each step
 *
 * The demo user must already have a client with the DEMO_CLIENT name and be on the Pro plan
 * (Progress Billing is Pro-only). Notes on how the real flow works, which shaped this script:
 *   - The Start dialog has no client field, so the job is created without one and the client is
 *     picked on each draw (that is where an invoice gets its client).
 *   - A draw's amount is typed as a line item (30% of $10,000 = 3,000.00 pre-tax); "% of project
 *     complete" is the cumulative figure (30, then 70). Contract maths is pre-tax, so "Invoiced to
 *     Date" reads $3,000.00 then $7,000.00 and Remaining Balance $7,000.00 then $3,000.00 even
 *     though each draw's invoice total includes 13% HST.
 *   - No payment is recorded, so "Received to Date" shows $0.00.
 *
 * This writes a real job and two real invoices to whichever database the app points at (local
 * dev and production share one Supabase project) - use the demo account. Cleanup deletes the
 * two draws, then the job (a job with draws can't be deleted first); if anything can't be
 * deleted you get a warning naming it and the reason.
 *
 * Run:  npm run record:demo:progress
 * Out:  scripts/record-demo/out/record-progress-billing.webm
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
const RAW_DIR = path.join(OUT_DIR, ".raw-progress");
const OUT_FILE = path.join(OUT_DIR, "record-progress-billing.webm");

const JOB_NAME = "Garage addition";
const CONTRACT = "10000";
const DRAWS = [
  { line: "Demolition and framing", price: "3000", percentComplete: "30" }, // 30% of the contract
  { line: "Drywall and electrical", price: "4000", percentComplete: "70" }, // + 40% = 70% billed
];

async function record(browser: Browser, tracker: CreatedTracker) {
  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context);
  try {
    await signIn(page, CREDS, true);
    await pause(page, 1000);

    // --- 1. Set the contract ---
    await caption(page, "1. Set the contract");
    await openNav(page, BASE_URL, "/dashboard/progress-billing");
    await clickWithCursor(page, page.getByRole("button", { name: "Start Progress Billing" }));
    const start = page.getByRole("dialog");
    await start.waitFor();
    // The job picker defaults to an EXISTING job when there is one: always switch to a new job, so
    // a contract is never put on a job that is not ours.
    if ((await start.locator("#progress-job").count()) > 0) {
      await clickWithCursor(page, start.locator("#progress-job"));
      await pickOption(page, "+ New job");
    }
    const nameInput = start.getByPlaceholder(/full renovation/i);
    await nameInput.waitFor();
    await typeWithCursor(page, nameInput, JOB_NAME);
    await typeWithCursor(page, start.locator("#progress-contract-value"), CONTRACT, { clear: true });
    await debugStep(page, "start dialog");
    await clickWithCursor(page, start.getByRole("button", { name: "Start", exact: true }));
    await start.waitFor({ state: "hidden" });

    // Our job's card (other progress-billed jobs may be listed too).
    const card = page
      .locator('[data-slot="card"]')
      .filter({ has: page.getByRole("link", { name: JOB_NAME, exact: true }) });
    await card.waitFor();
    // POST /api/jobs answers 200, not 201, when the name already exists (a job an earlier failed run
    // left behind), so the tracker would see nothing. The card's link is this job either way: adopt it.
    const jobHref = await card.getByRole("link", { name: JOB_NAME, exact: true }).first().getAttribute("href");
    const jobId = new RegExp("/jobs/([0-9a-f-]{36})").exec(jobHref ?? "")?.[1];
    if (jobId) {
      if (tracker.count("job") === 0) console.log(`Tracking the "${JOB_NAME}" job by its link (no new-job response was seen).`);
      tracker.adopt("job", jobId, JOB_NAME);
    }
    await moveTo(page, card);
    await pause(page, 1000);

    // --- 2 and 3. Bill the first draw, bill the next draw ---
    for (let i = 0; i < DRAWS.length; i++) {
      const draw = DRAWS[i];
      await caption(page, i === 0 ? "2. Bill the first draw" : "3. Bill the next draw");
      await clickWithCursor(page, card.getByRole("button", { name: "New Draw" }));
      const builder = page.getByRole("dialog");
      await builder.waitFor();
      await clickWithCursor(page, builder.locator("#doc-client"));
      await pickOption(page, CLIENT);
      await typeWithCursor(page, builder.getByLabel("Line name").first(), draw.line);
      await typeWithCursor(page, builder.getByPlaceholder("Price").first(), draw.price, { clear: true });
      await typeWithCursor(page, builder.locator("#draw-percent"), draw.percentComplete, { clear: true });
      await debugStep(page, `draw ${i + 1} form`);
      await clickWithCursor(page, builder.getByRole("button", { name: /^create invoice$/i }));
      await builder.waitFor({ state: "hidden" });
      // The page re-reads after the save and lists the new draw on the job's card.
      await card.getByText(`Draw #${i + 1}`).first().waitFor();
      await moveTo(page, card.getByText(`Draw #${i + 1}`).first());
      await pause(page, 1200);
    }

    // --- 4. See what's still owed ---
    await caption(page, "4. See what's still owed");
    await moveTo(page, card.getByText("Contract Value"));
    await debugStep(page, "job card");
    await pause(page, 3000);
    // The same draws on the Invoices list, each with its "Draw N" badge.
    // Best effort: the badge text is the one thing here not read from the code with certainty.
    try {
      await openNav(page, BASE_URL, "/dashboard/invoices");
      await page.getByText(/^Draw \d+$/).first().waitFor({ timeout: 8000 });
      await moveTo(page, page.getByText(/^Draw \d+$/).first());
      await pause(page, 2000);
    } catch (err) {
      console.warn(`Skipped the Invoices badge shot (${err instanceof Error ? err.message.split("\n")[0] : err}).`);
    }

    await tracker.expectCount("job", 1);
    await tracker.expectCount("invoice", DRAWS.length);
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
