/**
 * Records a phone-sized screen capture: sign in -> create a job -> add two
 * site photos -> open one full size -> the Photos page. Afterwards an
 * unrecorded second session deletes the demo job again.
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
 * if that fails you get a warning to delete it by hand.
 *
 * Run:  npm run record:demo:photos
 * Out:  scripts/record-demo/out/job-photos.webm
 */
import fs from "node:fs";
import path from "node:path";
import type { Browser, Page } from "playwright";
import {
  caption,
  clickWithCursor,
  installOverlay,
  launchBrowser,
  newPhoneContext,
  PHONE_CONTEXT_OPTIONS,
  moveTo,
  pause,
  pickOption,
  requireEnv,
  typeWithCursor,
} from "./helpers.ts";

const BASE_URL = (process.env.DEMO_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EMAIL = requireEnv("DEMO_EMAIL");
const PASSWORD = requireEnv("DEMO_PASSWORD");
const CLIENT = process.env.DEMO_CLIENT || "Sample Client";

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

// Set once the recording has created the demo job, so cleanup can delete that exact one.
let createdJobUrl: string | null = null;

const DEBUG = process.env.DEMO_DEBUG === "1";

/** DEMO_DEBUG=1: log the page's width/scale numbers, and what overflows, after a step. */
async function debugStep(page: Page, label: string) {
  if (!DEBUG) return;
  try {
    const info = await page.evaluate(() => {
      const innerWidth = window.innerWidth;
      const scrollWidth = document.documentElement.scrollWidth;
      const offenders =
        scrollWidth > innerWidth
          ? Array.from(document.querySelectorAll("body *"))
              .map((el) => ({ el, right: el.getBoundingClientRect().right }))
              .filter((x) => x.right > innerWidth)
              .sort((a, b) => b.right - a.right)
              .slice(0, 5)
              .map(({ el, right }) => ({
                tag: el.tagName.toLowerCase(),
                class: String(el.getAttribute("class") ?? "").slice(0, 120),
                id: el.id,
                text: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
                right: Math.round(right * 10) / 10,
              }))
          : [];
      return {
        innerWidth,
        scrollWidth,
        scale: window.visualViewport?.scale ?? null,
        viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? null,
        url: location.href,
        offenders,
      };
    });
    console.log(
      `[debug] ${label}: innerWidth=${info.innerWidth} scrollWidth=${info.scrollWidth} visualViewport.scale=${info.scale} url=${info.url}\n        meta viewport: ${info.viewportMeta}`,
    );
    for (const o of info.offenders) {
      console.log(`        overflow: <${o.tag}> id="${o.id}" class="${o.class}" text="${o.text}" right=${o.right}`);
    }
  } catch (err) {
    console.log(`[debug] ${label}: could not read page (${err instanceof Error ? err.message : err})`);
  }
}

async function signIn(page: Page, withCursor: boolean) {
  await page.goto(`${BASE_URL}/auth`);
  const password = page.getByRole("tab", { name: "Password" });
  if (withCursor) {
    await clickWithCursor(page, password);
    // #pw-email / #pw-password: the Magic Link tab has a second "Email" field.
    await typeWithCursor(page, page.locator("#pw-email"), EMAIL);
    await typeWithCursor(page, page.locator("#pw-password"), PASSWORD);
    await clickWithCursor(page, page.getByRole("button", { name: "Sign in", exact: true }));
  } else {
    await password.click();
    await page.locator("#pw-email").fill(EMAIL);
    await page.locator("#pw-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.waitForURL(/\/dashboard/);
}

async function record(browser: Browser) {
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });

  const context = await newPhoneContext(browser, RAW_DIR);
  if (DEBUG) {
    const o = PHONE_CONTEXT_OPTIONS;
    console.log(
      `[debug] context: isMobile=${o.isMobile} hasTouch=${o.hasTouch} viewport=${o.viewport.width}x${o.viewport.height} deviceScaleFactor=${o.deviceScaleFactor}`,
    );
  }
  // Init scripts only apply to pages opened after they are registered.
  await installOverlay(context);
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "light");
    } catch {}
  });
  const page = await context.newPage();
  try {
    page.setDefaultTimeout(20_000);

    await signIn(page, true);
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
    createdJobUrl = page.url();
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
  } finally {
    await context.close().catch(() => {});
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }
}

/** On a job's page: Delete, then confirm in the dialog, then wait for the jobs list. */
async function deleteCurrentJob(page: Page) {
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForURL(/\/dashboard\/jobs$/);
}

/**
 * Unrecorded: sign in again and delete the demo job through the UI. Never throws.
 * First the exact job the recording created (by its URL); then a sweep by name for
 * any leftover (e.g. from an earlier failed run).
 */
async function cleanup(browser: Browser) {
  try {
    const context = await newPhoneContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await signIn(page, false);

    let deleted = 0;
    if (createdJobUrl) {
      try {
        await page.goto(createdJobUrl);
        await deleteCurrentJob(page);
        deleted++;
      } catch (err) {
        console.warn(
          `Cleanup: could not delete ${createdJobUrl} directly (${err instanceof Error ? err.message : err}); trying by name.`,
        );
      }
    }

    // The list is server-rendered then hydrated, so wait for a row instead of
    // checking at once (an instant check reads "no job" on a page still loading).
    await page.goto(`${BASE_URL}/dashboard/jobs`);
    await page.waitForLoadState("networkidle").catch(() => {});
    for (let i = 0; i < 5; i++) {
      const card = page.getByRole("button", { name: JOB_NAME }).first();
      const found = await card.waitFor({ state: "visible", timeout: i === 0 ? 5000 : 2000 }).then(
        () => true,
        () => false,
      );
      if (!found) break;
      await card.click();
      await page.waitForURL(/\/dashboard\/jobs\/[^/]+$/);
      await deleteCurrentJob(page);
      deleted++;
    }
    await context.close();
    if (deleted === 0) {
      console.warn(
        `Cleanup: nothing was deleted${createdJobUrl ? "" : " (the recording never created the job)"}. If "${JOB_NAME}" exists, delete it by hand.`,
      );
    } else {
      console.log(`Cleanup: deleted ${deleted} demo job(s).`);
    }
  } catch (err) {
    console.warn(
      `\nWARNING: cleanup failed. Delete the job "${JOB_NAME}" (and its photos) by hand in the demo account.\n`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function main() {
  const browser = await launchBrowser();
  try {
    await record(browser);
  } finally {
    // Runs even if the recording failed part-way, so a half-made job is removed.
    await cleanup(browser);
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
