/**
 * Records a phone-sized screen capture (~60 s; see CLOCKED_WAIT_MS for why it is not shorter):
 * sign in -> add the employee "Alex Demo" with a PIN (the real Employees page) -> open the shared
 * employee sign-in link in the SAME page and sign in with the PIN -> clock in on a throwaway job
 * -> wait -> clock out -> back to the owner view: the hours on the job. Afterwards an unrecorded
 * second session removes what the run made.
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL   app to record, default http://localhost:3000
 *   DEMO_EMAIL      demo user's email (password sign-in)
 *   DEMO_PASSWORD   demo user's password
 *   DEMO_CLIENT     name of the existing client for the throwaway job, default "Sample Client"
 *   DEMO_HEADED     set to 1 to watch in a visible, slowed-down browser
 *   DEMO_DEBUG      set to 1 to log viewport/scale/overflow diagnostics after each step
 *
 * Nothing in this flow sends an email or a text: the PIN is typed on the owner's own screen and
 * the employee signs in by opening the shared link in the same browser. The shared link is READ
 * from the Employees page; "Create sign-in link" is only pressed if the account has none yet, and
 * "Regenerate" (which signs real employees out) is never pressed.
 *
 * The throwaway job is created in an unrecorded setup session first (the employee's job list shows
 * every job, and it has to exist before they clock in); the recording itself never shows it being
 * made. Everything uses fictional data (Alex Demo, PIN 4821).
 *
 * This writes a real employee, a PIN, a clocked session (+ its hours entry) and a job to whichever
 * database the app points at (local dev and production share one Supabase project) - use the demo
 * account. Cleanup runs in the order the app allows: the clocked session(s) and their hours
 * entries, then the employee's login and the employee, then the job.
 *
 * CANNOT BE FULLY CLEANED UP: the app has no way to DELETE an employee (their hours history keeps
 * them; the Employees page only offers Deactivate). Cleanup removes the login and deactivates
 * "Alex Demo", so the row stays as Inactive and is listed at the end. Same for the shared sign-in
 * link if this run had to create it.
 *
 * Run:  npm run record:demo:clockin
 * Out:  scripts/record-demo/out/record-clock-in.webm
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import {
  caption,
  CLEANUP_INCOMPLETE_EXIT,
  cleanupCreated,
  clickWithCursor,
  CreatedTracker,
  debugStep,
  hideControls,
  launchBrowser,
  moveTo,
  newPhoneContext,
  newRecordingPage,
  openNav,
  pause,
  pickOption,
  requireEnv,
  signIn,
  typeWithCursor,
} from "./helpers.ts";

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CLIENT = process.env.DEMO_CLIENT || "Sample Client";
const CREDS = { baseUrl: BASE_URL, email: EMAIL, password: PASSWORD };

const OUT_DIR = path.join(import.meta.dirname, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw-clock-in");
const OUT_FILE = path.join(OUT_DIR, "record-clock-in.webm");

const EMPLOYEE_NAME = "Alex Demo";
const EMPLOYEE_PIN = "4821";
const PAY_RATE = "30";
const BILLABLE_RATE = "60";
const JOB_NAME = "Clock-in demo job";

// The database rounds a session to hundredths of an hour (round(seconds / 3600, 2)) and only
// writes an hours entry when that is above 0, so a session shorter than 18 seconds leaves NO
// hours on the job and the last step would have nothing to show. 20 s clears it with margin.
const CLOCKED_WAIT_MS = 20_000;

type Left = { what: string; where: string; why: string };

/** The employee the recording created, filled from the app's own 201 response. */
const employee: { id: string | null } = { id: null };
let createdLink = false;

/** Setup, not recorded: the employee's job list shows every job, so the throwaway one comes first. */
async function createThrowawayJob(browser: Browser, tracker: CreatedTracker) {
  const context = await newPhoneContext(browser);
  tracker.watch(context);
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await signIn(page, CREDS, false);
    await page.goto(`${BASE_URL}/dashboard/jobs`);
    await page.getByRole("button", { name: "New job" }).first().click();
    await page.locator("#job-name").fill(JOB_NAME);
    await page.locator("#job-customer").click();
    await pickOption(page, CLIENT);
    await page.getByRole("button", { name: "Create job" }).click();
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    tracker.addFromUrl(page.url());
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  } finally {
    await context.close().catch(() => {});
  }
}

function employeeRow(page: Page) {
  // Active rows only: a leftover inactive "Alex Demo" from an earlier run must never be picked.
  return page
    .locator("div.divide-y > div")
    .filter({ hasText: EMPLOYEE_NAME })
    .filter({ hasNotText: "Inactive" })
    .first();
}

async function typePinOnKeyboard(page: Page, pin: string) {
  // The PIN pad listens for digit keys on the window (same as a user with a keyboard).
  for (const digit of pin) {
    await page.keyboard.press(digit);
    await page.waitForTimeout(220);
  }
}

async function record(browser: Browser, tracker: CreatedTracker) {
  await createThrowawayJob(browser, tracker);
  await tracker.settle();
  const job = tracker.items.find((i) => i.kind === "job");
  if (!job) throw new Error("The throwaway job was created but its id was not captured.");

  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context);
  context.on("response", (res) => {
    if (res.request().method() !== "POST" || res.status() !== 201) return;
    if (new URL(res.url()).pathname !== "/api/employees") return;
    res
      .json()
      .then((body: { employee?: { id?: string } }) => {
        if (body.employee?.id) employee.id = body.employee.id;
      })
      .catch(() => {});
  });
  await hideControls(context, /\b(export|csv|quickbooks|import|accountant|bundle|statements?)\b/i);
  try {
    await signIn(page, CREDS, true);
    await pause(page, 800);

    // --- 1. Add your employee ---
    await caption(page, "1. Add your employee");
    await openNav(page, BASE_URL, "/dashboard/employees");
    await clickWithCursor(page, page.getByRole("button", { name: "New employee", exact: true }));
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    await typeWithCursor(page, dialog.locator("#emp-name"), EMPLOYEE_NAME);
    await typeWithCursor(page, dialog.locator("#emp-rate"), PAY_RATE, { clear: true });
    await typeWithCursor(page, dialog.locator("#emp-billable-rate"), BILLABLE_RATE, { clear: true });
    await debugStep(page, "employee form");
    await clickWithCursor(page, dialog.getByRole("button", { name: "Add employee" }));
    await dialog.waitFor({ state: "hidden" });

    const row = employeeRow(page);
    await row.waitFor();
    await clickWithCursor(page, row.getByRole("button", { name: "Set PIN" }));
    const pinDialog = page.getByRole("dialog");
    await pinDialog.getByText("Enter new PIN").waitFor();
    await typePinOnKeyboard(page, EMPLOYEE_PIN);
    await pinDialog.getByText("Confirm new PIN").waitFor();
    await pause(page, 500);
    await typePinOnKeyboard(page, EMPLOYEE_PIN);
    await pinDialog.waitFor({ state: "hidden" });
    await row.getByText("PIN set").waitFor();
    await debugStep(page, "employee with PIN");
    await pause(page, 1000);

    // --- 2. They clock in with a PIN ---
    await caption(page, "2. They clock in with a PIN");
    const loginCard = page.locator('[data-slot="card"]').filter({ hasText: "Employee login" });
    const linkInput = loginCard.locator("input[readonly]");
    if (!(await linkInput.isVisible().catch(() => false))) {
      await clickWithCursor(page, loginCard.getByRole("button", { name: "Create sign-in link" }));
      await linkInput.waitFor();
      createdLink = true; // only once the link was seen to exist
    }
    await linkInput.waitFor();
    const signInLink = await linkInput.inputValue();
    if (!/\/employee-login\/[^/]+$/.test(signInLink)) {
      throw new Error(`The shared sign-in link on the page looks wrong: ${signInLink}`);
    }
    await moveTo(page, linkInput);
    await pause(page, 1200);
    // The same page and context, the way the employee would open the link from their own phone.
    await page.goto(signInLink);
    await page.locator("#employee-name").waitFor();
    await clickWithCursor(page, page.locator("#employee-name"));
    await pickOption(page, EMPLOYEE_NAME);
    for (const digit of EMPLOYEE_PIN) {
      await clickWithCursor(page, page.getByRole("button", { name: digit, exact: true }));
    }
    await page.waitForURL(/\/employee\/hours/);
    await page.locator("#clock-job").waitFor();
    await debugStep(page, "employee clock-in page");
    await clickWithCursor(page, page.locator("#clock-job"));
    await pickOption(page, JOB_NAME);
    await clickWithCursor(page, page.getByRole("button", { name: "Clock in", exact: true }));
    await page.getByText("Clocked in", { exact: true }).waitFor();
    await debugStep(page, "clocked in");

    // --- 3. Clock out when done ---
    await caption(page, "3. Clock out when done");
    await moveTo(page, page.getByText(JOB_NAME).first());
    await pause(page, CLOCKED_WAIT_MS); // the live timer runs; see CLOCKED_WAIT_MS
    await clickWithCursor(page, page.getByRole("button", { name: "Clock out", exact: true }));
    // The finished session lands in "Your recent hours" with its hours (0.01 h or more).
    const finished = page.getByText(/^\d+\.\d\d h$/).first();
    await finished.waitFor();
    if (/^0\.00 h$/.test((await finished.innerText()).trim())) {
      throw new Error("The session was too short to record any hours; raise CLOCKED_WAIT_MS.");
    }
    await moveTo(page, finished);
    await debugStep(page, "clocked out");
    await pause(page, 1200);

    // --- 4. Hours land on the right job ---
    await caption(page, "4. Hours land on the right job");
    await page.goto(`${BASE_URL}${job.path}`);
    // Fails loudly (rather than recording an empty job) if the hours did not land on it.
    const hoursEntry = page.getByText(/\d+(\.\d+)?h @/).first();
    await hoursEntry.waitFor();
    await moveTo(page, hoursEntry);
    await debugStep(page, "hours on the job");
    await pause(page, 3000);

    const video = page.video();
    await context.close(); // flushes the video
    await video?.saveAs(OUT_FILE);
    console.log(`Saved ${OUT_FILE}`);
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }
}

/** Run `act` and require the app's own request of `method` on `pathRegex` to succeed. */
async function expectCall(page: Page, method: string, pathRegex: RegExp, act: () => Promise<void>) {
  const response = page.waitForResponse(
    (r) => r.request().method() === method && pathRegex.test(new URL(r.url()).pathname),
    { timeout: 15_000 },
  );
  response.catch(() => {});
  await act();
  const r = await response;
  if (!r.ok() && r.status() !== 404) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`${method} answered ${r.status()}${body?.error ? `: ${body.error}` : ""}`);
  }
}

/**
 * Unrecorded: the employee's clocked sessions (their hours entries go with them), then their login,
 * then Deactivate (there is no delete). Returns what could not be done; never throws.
 */
async function cleanupEmployee(browser: Browser): Promise<{ failures: Left[]; notes: Left[] }> {
  const failures: Left[] = [];
  const notes: Left[] = [];
  const where = `${BASE_URL}/dashboard/employees`;
  if (!employee.id) {
    // Only things whose creation was observed are listed; the sign-in link can't exist without it here.
    console.log("Cleanup: no employee was created, so there is no employee to clean up.");
    if (createdLink) {
      notes.push({
        what: "the shared employee sign-in link",
        where,
        why: "this run created it; the app can only regenerate it, not remove it",
      });
    }
    return { failures, notes };
  }
  const id = employee.id;
  let context: BrowserContext | null = null;
  try {
    context = await newPhoneContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await signIn(page, CREDS, false);
    await page.goto(where);
    const row = employeeRow(page);
    await row.waitFor();

    // 1. Sessions (open or finished): deleting one also removes its hours entry.
    try {
      await row.getByRole("button", { name: "Sessions" }).click();
      const sessions = page.getByRole("dialog").filter({ hasText: "sessions" }).first();
      await sessions.waitFor();
      await sessions.getByText(/No clocked sessions yet|Open|·|–/).first().waitFor();
      for (let i = 0; i < 10; i++) {
        const trash = sessions.locator('button[title="Delete session"]');
        if ((await trash.count()) === 0) break;
        await expectCall(page, "DELETE", /^\/api\/time-sessions\/[0-9a-f-]{36}$/, async () => {
          await trash.first().click();
          await page
            .getByRole("dialog")
            .filter({ hasText: "Delete this clocked session" })
            .getByRole("button", { name: "Delete session", exact: true })
            .click();
        });
        await page.waitForTimeout(500);
      }
      await page.keyboard.press("Escape");
    } catch (err) {
      failures.push({
        what: `clocked session(s) of "${EMPLOYEE_NAME}"`,
        where,
        why: err instanceof Error ? err.message.split("\n")[0] : String(err),
      });
    }

    // 2. Login, then Deactivate.
    try {
      const remove = row.getByRole("button", { name: "Remove login" });
      if (await remove.isVisible().catch(() => false)) {
        await expectCall(page, "DELETE", new RegExp(`^/api/employees/${id}/pin$`), () => remove.click());
      }
      await expectCall(page, "PATCH", new RegExp(`^/api/employees/${id}$`), () =>
        row.getByRole("button", { name: "Deactivate" }).click(),
      );
      notes.push({
        what: `employee "${EMPLOYEE_NAME}"`,
        where,
        why: "the app has no way to delete an employee; the login was removed and the employee deactivated (shown as Inactive)",
      });
    } catch (err) {
      failures.push({
        what: `employee "${EMPLOYEE_NAME}" (login and active status)`,
        where,
        why: err instanceof Error ? err.message.split("\n")[0] : String(err),
      });
    }
  } catch (err) {
    failures.push({
      what: `employee "${EMPLOYEE_NAME}" and their sessions`,
      where,
      why: `could not clean up: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
    });
  } finally {
    await context?.close().catch(() => {});
  }
  if (createdLink) {
    notes.push({
      what: "the shared employee sign-in link",
      where,
      why: "this run had to create it (the account had none); the app can only regenerate it, not remove it, and regenerating would sign real employees out",
    });
  }
  return { failures, notes };
}

async function main() {
  const browser = await launchBrowser();
  const tracker = new CreatedTracker();
  let left = 0;
  try {
    await record(browser, tracker);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    try {
      // Order the app allows: sessions/hours -> employee -> job.
      const { failures, notes } = await cleanupEmployee(browser);
      left += failures.length;
      left += await cleanupCreated(browser, tracker, CREDS);
      if (failures.length > 0) {
        const bar = "!".repeat(70);
        console.warn(`\n${bar}\nLEFT BEHIND: cleanup could NOT finish ${failures.length} step(s):\n`);
        for (const f of failures) console.warn(`  - ${f.what}: ${f.where}\n      ${f.why}`);
        console.warn(`${bar}\n`);
      }
      if (notes.length > 0) {
        console.warn("Still in the demo account (the app cannot remove these):");
        for (const n of notes) console.warn(`  - ${n.what}: ${n.where}\n      ${n.why}`);
      }
    } catch (err) {
      left = Math.max(left, 1);
      console.error(`Cleanup crashed (${err instanceof Error ? err.message : err}). Check the demo account by hand:`);
      console.error(`  - employee "${EMPLOYEE_NAME}": ${BASE_URL}/dashboard/employees`);
      for (const item of tracker.items) console.error(`  - ${item.kind} "${item.label}": ${BASE_URL}${item.path}`);
    }
    await browser.close().catch(() => {});
    if (left > 0 && !process.exitCode) process.exitCode = CLEANUP_INCOMPLETE_EXIT;
  }
}

main();
