/**
 * Records a phone-sized screen capture: sign in -> create a job -> add two
 * site photos -> open one full size -> the Photos page. Afterwards an
 * unrecorded second session deletes the demo job again (by the id the run captured).
 *
 * Env vars (nothing is hardcoded):
 *   DEMO_BASE_URL   app to record, default http://localhost:3000
 *   DEMO_EMAIL      demo user's email (password sign-in)
 *   DEMO_PASSWORD   demo user's password
 *   DEMO_CLIENT     name of the existing client to pick, default "Sample Client"
 *   DEMO_HEADED     set to 1 to watch in a visible, slowed-down browser
 *   DEMO_DEBUG      set to 1 to log viewport/scale/overflow diagnostics after each step
 *
 * Needs two images in scripts/record-demo/assets/ (git-ignored, never commit
 * them): site-1.jpg (an old kitchen) and site-2.jpg (a basement water heater).
 * A doubled extension (site-1.jpg.jpg) is accepted too.
 *
 * This writes a real job and two real photos to whichever database the app
 * points at (local dev and production share one Supabase project) - use the
 * demo account. The cleanup step deletes the job (and its photos) afterwards;
 * if that fails you get a warning naming it.
 *
 * Run:  npm run record:demo:photos
 * Out:  scripts/record-demo/out/job-photos.webm
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

const JOB_NAME = "Kitchen & basement update";
const JOB_LOCATION = "123 Maple Street, Mississauga";

const HERE = import.meta.dirname;
const OUT_DIR = path.join(HERE, "out");
const RAW_DIR = path.join(OUT_DIR, ".raw-photos");
const OUT_FILE = path.join(OUT_DIR, "job-photos.webm");

function findAsset(base: string): string | null {
  for (const name of [base, `${base}.jpg`]) {
    const file = path.join(HERE, "assets", name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

const PHOTOS = [findAsset("site-1.jpg"), findAsset("site-2.jpg")];
if (PHOTOS.some((p) => p === null)) {
  console.error(
    "Missing demo photos. Put site-1.jpg (an old kitchen) and site-2.jpg (a basement water heater) in scripts/record-demo/assets/ and run again.",
  );
  process.exit(1);
}
const PHOTO_FILES = PHOTOS as string[];

async function record(browser: Browser, tracker: CreatedTracker) {
  const { context, page } = await newRecordingPage(browser, RAW_DIR);
  tracker.watch(context);
  try {
    await signIn(page, CREDS, true);
    await pause(page, 1000);

    // --- 1. Create a job ---
    await caption(page, "1. Create a job");
    const jobsLink = page.getByRole("link", { name: "Jobs", exact: true }).first();
    if (await jobsLink.isVisible().catch(() => false)) {
      await clickWithCursor(page, jobsLink);
    } else {
      await page.goto(`${BASE_URL}/dashboard/jobs`);
    }
    await page.waitForURL(/\/dashboard\/jobs$/);
    await clickWithCursor(page, page.getByRole("button", { name: "New job" }).first());
    await debugStep(page, "job form");
    await typeWithCursor(page, page.locator("#job-name"), JOB_NAME);
    await typeWithCursor(page, page.locator("#job-location"), JOB_LOCATION);
    await clickWithCursor(page, page.locator("#job-customer"));
    await pickOption(page, CLIENT);
    await clickWithCursor(page, page.getByRole("button", { name: "Create job" }));
    // Creating a job already navigates to its page (NewJobDialog's onCreated
    // does router.push), so there is no list row to click: wait for the page.
    await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
    tracker.addFromUrl(page.url());
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await debugStep(page, "job page");
    await pause(page, 800);

    // --- 2. Add site photos ---
    await caption(page, "2. Add site photos");
    await clickWithCursor(page, page.getByRole("button", { name: "Add photos", exact: true }));
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    // Glide to the real button for the video, but feed the hidden file input
    // directly: a native file chooser can't be driven or recorded.
    await moveTo(page, dialog.getByRole("button", { name: "Choose from gallery" }));
    await dialog.getByLabel("Choose photos from gallery").setInputFiles(PHOTO_FILES);
    await dialog.getByRole("button", { name: /^upload 2 photos$/i }).waitFor();
    await pause(page, 1200);
    await clickWithCursor(page, dialog.getByRole("button", { name: /^upload 2 photos$/i }));
    await dialog.waitFor({ state: "hidden", timeout: 60_000 });

    // Both thumbnails present and actually loaded.
    const thumbs = page.getByRole("button", { name: /^open photo/i });
    await thumbs.nth(0).waitFor({ timeout: 60_000 });
    await debugStep(page, "first thumbnail appeared");
    await thumbs.nth(1).waitFor({ timeout: 60_000 });
    await debugStep(page, "second thumbnail appeared");
    await page.waitForFunction(
      () => {
        const imgs = Array.from(document.querySelectorAll("button[aria-label^='Open photo'] img"));
        return imgs.length >= 2 && imgs.every((i) => (i as HTMLImageElement).naturalWidth > 0);
      },
      undefined,
      { timeout: 60_000 },
    );
    await pause(page, 1200);

    // --- 3. Tap to view full size ---
    await caption(page, "3. Tap to view full size");
    await clickWithCursor(page, thumbs.first());
    await page.getByRole("dialog").waitFor();
    await debugStep(page, "viewer open");
    await pause(page, 1500);
    await clickWithCursor(page, page.getByRole("dialog").getByRole("button", { name: "Close" }).first());
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await debugStep(page, "viewer closed");

    // --- 4. Everything in one place ---
    await caption(page, "4. Everything in one place");
    // The nav items are Base UI buttons rendered as <a href> (role "button",
    // not "link"), and their name carries the unsorted badge ("Photos 2"), so
    // match the anchor by href. On a phone Photos sits in the "More" sheet.
    const photosHref = 'a[href="/dashboard/photos"]';
    try {
      const inBar = page.locator(`nav ${photosHref}`).first();
      if (!(await inBar.isVisible().catch(() => false))) {
        await clickWithCursor(page, page.getByRole("button", { name: "More" }).first());
      }
      const photosEntry = page.locator(`nav ${photosHref}, [role="dialog"] ${photosHref}`);
      await photosEntry.first().waitFor({ state: "visible", timeout: 5000 });
      await clickWithCursor(page, photosEntry.first());
    } catch {
      // Not reachable by clicking: go there directly, caption stays.
      await page.goto(`${BASE_URL}/dashboard/photos`);
    }
    await page.waitForURL(/\/dashboard\/photos/);
    await debugStep(page, "Photos page");
    await pause(page, 2000);

    const video = page.video();
    await context.close(); // flushes the video
    await video?.saveAs(OUT_FILE);
    console.log(`Saved ${OUT_FILE}`);
    await tracker.expectCount("job", 1);
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }
}

runDemo(CREDS, record);
