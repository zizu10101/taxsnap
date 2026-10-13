import fs from "node:fs";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Response,
} from "playwright";

// NOTE: record against a PRODUCTION build when you can (npm run build && npm run start, then
// DEMO_BASE_URL=http://localhost:3000). `npm run dev` adds things that do not belong in a demo:
// the Next.js dev indicator and error overlay, slower first loads while Turbopack compiles routes
// on demand (dead air in the video), and extra dev-only re-renders. A production build also shows
// what customers actually get. As a safety net, the dev overlay is hidden in every recording
// context (see hideDevOverlay below; DEMO_SHOW_DEV_OVERLAY=1 turns that off for debugging).
//
// Shared pieces for the scripted demo recordings: a visible cursor dot, a
// caption bar fixed to the bottom of the screen, human-speed typing and short
// pauses. The cursor and caption are injected into every page (and restored
// after a navigation from sessionStorage) so they survive client and full-page
// navigations alike. Playwright's video does not capture the real mouse, which
// is why the dot is drawn in the page.

export const STEP_PAUSE_MS = 400;
export const KEY_DELAY_MS = 60;

// Runs in the page, not in node: kept as a plain string so no TS types leak in.
const OVERLAY_SCRIPT = `
(() => {
  const POS_KEY = "__demo_cursor";
  const CAP_KEY = "__demo_caption";
  function build() {
    if (document.getElementById("__demo_cursor")) return;
    const dot = document.createElement("div");
    dot.id = "__demo_cursor";
    let pos = { x: 195, y: 420 };
    try { pos = JSON.parse(sessionStorage.getItem(POS_KEY) || "") || pos; } catch (e) {}
    dot.style.cssText = [
      "position:fixed", "z-index:2147483647", "pointer-events:none",
      "width:22px", "height:22px", "margin:-11px 0 0 -11px", "border-radius:50%",
      "background:rgba(194,65,12,0.85)", "border:2px solid #fff",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
      "transition:left 350ms ease-in-out, top 350ms ease-in-out, transform 120ms",
      "left:" + pos.x + "px", "top:" + pos.y + "px"
    ].join(";");
    document.documentElement.appendChild(dot);

    const bar = document.createElement("div");
    bar.id = "__demo_caption";
    bar.style.cssText = [
      "position:fixed", "left:0", "right:0", "bottom:0", "z-index:2147483646",
      "pointer-events:none", "padding:18px 16px 28px", "text-align:center",
      "font:600 18px/1.25 system-ui,-apple-system,Segoe UI,sans-serif",
      "color:#fff7ed", "background:rgba(28,25,23,0.92)"
    ].join(";");
    bar.textContent = sessionStorage.getItem(CAP_KEY) || "";
    bar.style.display = bar.textContent ? "block" : "none";
    document.documentElement.appendChild(bar);
  }
  addEventListener("DOMContentLoaded", build);
  if (document.readyState !== "loading") build();
  window.__demoMove = (x, y) => {
    build();
    const dot = document.getElementById("__demo_cursor");
    dot.style.left = x + "px";
    dot.style.top = y + "px";
    try { sessionStorage.setItem(POS_KEY, JSON.stringify({ x: x, y: y })); } catch (e) {}
  };
  window.__demoPress = (down) => {
    const dot = document.getElementById("__demo_cursor");
    if (dot) dot.style.transform = down ? "scale(0.7)" : "scale(1)";
  };
  window.__demoCaption = (text) => {
    build();
    const bar = document.getElementById("__demo_caption");
    bar.textContent = text;
    bar.style.display = text ? "block" : "none";
    try { sessionStorage.setItem(CAP_KEY, text); } catch (e) {}
  };
})();
`;

type DemoWindow = Window & {
  __demoMove: (x: number, y: number) => void;
  __demoPress: (down: boolean) => void;
  __demoCaption: (text: string) => void;
};

export async function installOverlay(context: BrowserContext) {
  await context.addInitScript(OVERLAY_SCRIPT);
}

export const pause = (page: Page, ms = STEP_PAUSE_MS) => page.waitForTimeout(ms);

export async function caption(page: Page, text: string) {
  await page.evaluate((t) => (window as unknown as DemoWindow).__demoCaption(t), text);
  await pause(page);
}

/** Glide the dot to the middle of an element (scrolled into view first). */
export async function moveTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("moveTo: element has no bounding box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([px, py]) => (window as unknown as DemoWindow).__demoMove(px, py), [x, y]);
  await page.waitForTimeout(450); // let the 350ms glide finish
}

export async function clickWithCursor(page: Page, target: Locator) {
  await moveTo(page, target);
  await page.evaluate(() => (window as unknown as DemoWindow).__demoPress(true));
  await page.waitForTimeout(120);
  await target.click();
  // The click may have navigated away; the dot is rebuilt on the next page.
  await page.evaluate(() => (window as unknown as DemoWindow).__demoPress(false)).catch(() => {});
  await pause(page);
}

/** Click the field, optionally clear it, and type at ~60ms per key. */
export async function typeWithCursor(
  page: Page,
  target: Locator,
  text: string,
  opts: { clear?: boolean } = {},
) {
  await moveTo(page, target);
  await target.click();
  if (opts.clear) await page.keyboard.press("Control+A");
  await target.pressSequentially(text, { delay: KEY_DELAY_MS });
  await pause(page);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the header of the script for the env vars.`);
    process.exit(1);
  }
  return value;
}

/** DEMO_HEADED=1 opens a visible, slowed-down browser so you can watch. */
export function launchBrowser(): Promise<Browser> {
  return process.env.DEMO_HEADED === "1"
    ? chromium.launch({ headless: false, slowMo: 50 })
    : chromium.launch();
}

/**
 * Phone-sized, light-theme context; pass `rawDir` to record video into it.
 * The video size must equal the viewport (CSS px): a larger canvas is not
 * scaled up, the page just sits in its top-left corner on grey padding.
 * deviceScaleFactor 2 only sharpens the page; it does not change the video size.
 */
export const PHONE_CONTEXT_OPTIONS = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
} as const;

export async function newPhoneContext(browser: Browser, rawDir?: string) {
  const context = await browser.newContext({
    ...PHONE_CONTEXT_OPTIONS,
    ...(rawDir ? { recordVideo: { dir: rawDir, size: { width: 390, height: 844 } } } : {}),
  });
  await hideDevOverlay(context);
  return context;
}

// Next 16 renders its whole dev UI (indicator badge, toasts, the error overlay and its dialog)
// inside the <nextjs-portal> shadow host, so hiding the host hides all of it; the data-* names are
// the elements it uses inside, listed in case a version renders them outside the host. Only these
// exact names: nothing here can match app UI. Injected as an init script so it is present on every
// page, navigation and new tab of the context - recordings and the cleanup sessions alike.
const DEV_OVERLAY_CSS = [
  "nextjs-portal",
  "[data-nextjs-toast]",
  "[data-nextjs-dev-tools-button]",
  "[data-nextjs-dev-overlay]",
  "[data-nextjs-dialog-overlay]",
  "[data-next-badge-root]",
  "#__next-build-watcher",
].join(",") + "{display:none !important;visibility:hidden !important;}";

async function hideDevOverlay(context: BrowserContext) {
  if (process.env.DEMO_SHOW_DEV_OVERLAY === "1") return;
  await context.addInitScript((css) => {
    const add = () => {
      if (document.getElementById("__demo_hide_dev_overlay")) return;
      const style = document.createElement("style");
      style.id = "__demo_hide_dev_overlay";
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
    };
    add();
    document.addEventListener("DOMContentLoaded", add);
  }, DEV_OVERLAY_CSS);
}

/** Click an option of an opened dropdown by role, falling back to its visible text. */
export async function pickOption(page: Page, name: string) {
  const byRole = page.getByRole("option", { name, exact: true });
  const option = (await byRole.waitFor({ timeout: 3000 }).then(() => true, () => false))
    ? byRole
    : page.getByRole("listbox").getByText(name, { exact: true });
  await clickWithCursor(page, option);
}

// ---------------------------------------------------------------------------
// Sign-in, recording scaffold, DEMO_DEBUG diagnostics
// ---------------------------------------------------------------------------

export interface DemoCreds {
  baseUrl: string;
  email: string;
  password: string;
}

export async function signIn(page: Page, creds: DemoCreds, withCursor: boolean) {
  await page.goto(`${creds.baseUrl}/auth`);
  const password = page.getByRole("tab", { name: "Password" });
  if (withCursor) {
    await clickWithCursor(page, password);
    // #pw-email / #pw-password: the Magic Link tab has a second "Email" field.
    await typeWithCursor(page, page.locator("#pw-email"), creds.email);
    await typeWithCursor(page, page.locator("#pw-password"), creds.password);
    await clickWithCursor(page, page.getByRole("button", { name: "Sign in", exact: true }));
  } else {
    await password.click();
    await page.locator("#pw-email").fill(creds.email);
    await page.locator("#pw-password").fill(creds.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await page.waitForURL(/\/dashboard/);
}

export const DEBUG = process.env.DEMO_DEBUG === "1";

/** DEMO_DEBUG=1: log the page's width/scale numbers, and what overflows, after a step. */
export async function debugStep(page: Page, label: string) {
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

/**
 * A fresh recording context + page: video into `rawDir` (emptied first), the cursor/caption
 * overlay and the light theme installed. Init scripts only apply to pages opened afterwards,
 * so this must run before the first navigation.
 */
export async function newRecordingPage(browser: Browser, rawDir: string) {
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const context = await newPhoneContext(browser, rawDir);
  if (DEBUG) {
    const o = PHONE_CONTEXT_OPTIONS;
    console.log(
      `[debug] context: isMobile=${o.isMobile} hasTouch=${o.hasTouch} viewport=${o.viewport.width}x${o.viewport.height} deviceScaleFactor=${o.deviceScaleFactor}`,
    );
  }
  await installOverlay(context);
  // The app reads a "theme" localStorage key before first paint.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("theme", "light");
    } catch {}
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return { context, page };
}

/**
 * Open a main-nav destination the way a user would: the bottom bar, else the "More" sheet,
 * else (not reachable by clicking) straight to the URL. Nav items are Base UI buttons
 * rendered as <a href>, so they are matched by href, not by role/name.
 */
export async function openNav(page: Page, baseUrl: string, href: string) {
  try {
    const inBar = page.locator(`nav a[href="${href}"]`).first();
    if (!(await inBar.isVisible().catch(() => false))) {
      await clickWithCursor(page, page.getByRole("button", { name: "More" }).first());
    }
    const entry = page.locator(`nav a[href="${href}"], [role="dialog"] a[href="${href}"]`);
    await entry.first().waitFor({ state: "visible", timeout: 5000 });
    await clickWithCursor(page, entry.first());
  } catch {
    await page.goto(`${baseUrl}${href}`);
  }
  await page.waitForURL(new RegExp(`${href.replace(/\//g, "\\/")}(\\?.*)?$`));
}

// ---------------------------------------------------------------------------
// Everything a recording creates is tracked, then deleted again through the UI
// ---------------------------------------------------------------------------

export type CreatedKind = "invoice" | "estimate" | "expense" | "job";

export interface CreatedItem {
  kind: CreatedKind;
  id: string;
  /** Human label for warnings: a job/merchant name, or the document type. */
  label: string;
  /** Where to find it by hand if cleanup fails. */
  path: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Records the id of every job, estimate, invoice and expense the recorded run creates.
 * Ids come from the app's own 201 responses (POST /api/jobs, /api/documents, /api/receipts
 * and the estimate->invoice convert route) and, for pages, from the URL the run lands on.
 * Only a 201 counts: POST /api/jobs answers 200 for a job that already existed, and that
 * one is not ours to delete.
 */
export class CreatedTracker {
  readonly items: CreatedItem[] = [];
  private readonly pending: Promise<void>[] = [];

  watch(context: BrowserContext) {
    context.on("response", (res) => {
      if (res.request().method() !== "POST" || res.status() !== 201) return;
      this.pending.push(this.fromResponse(res).catch(() => {}));
    });
  }

  private async fromResponse(res: Response) {
    const pathname = new URL(res.url()).pathname;
    const isDocument =
      pathname === "/api/documents" || new RegExp(`^/api/documents/${UUID}/convert$`).test(pathname);
    if (!isDocument && pathname !== "/api/receipts" && pathname !== "/api/jobs") return;
    let body: Record<string, { id?: string; type?: string; name?: string; merchant_name?: string }>;
    try {
      body = await res.json();
    } catch {
      console.warn(
        `Tracker: created something at ${pathname} but could not read its id (a URL capture may still cover it).`,
      );
      return;
    }
    if (isDocument && body.document?.id) {
      const kind = body.document.type === "estimate" ? "estimate" : "invoice";
      this.add(kind, body.document.id, kind);
    } else if (pathname === "/api/receipts" && body.receipt?.id) {
      this.add("expense", body.receipt.id, body.receipt.merchant_name ?? "expense");
    } else if (pathname === "/api/jobs" && body.job?.id) {
      this.add("job", body.job.id, body.job.name ?? "job");
    }
  }

  /** Also remember a page the run is on (/dashboard/invoices|estimates|jobs/<id>): a second source for the same id. */
  addFromUrl(url: string) {
    const m = new RegExp(`/dashboard/(invoices|estimates|jobs)/(${UUID})(?:[/?#]|$)`).exec(url);
    if (!m) return;
    const kind: CreatedKind = m[1] === "invoices" ? "invoice" : m[1] === "estimates" ? "estimate" : "job";
    this.add(kind, m[2], kind);
  }

  /**
   * Track something the run is known to own although no 201 was seen for it. POST /api/jobs
   * answers 200 (not 201) for a name that already exists - e.g. one a previous failed run left
   * behind - so a script that finds its job on screen adopts it here by id.
   */
  adopt(kind: CreatedKind, id: string, label: string) {
    this.add(kind, id, label);
  }

  private add(kind: CreatedKind, id: string, label: string) {
    const existing = this.items.find((i) => i.kind === kind && i.id === id);
    if (existing) {
      // A response knows the real name; a URL capture only knows the kind.
      if (existing.label === existing.kind) existing.label = label;
      return;
    }
    const path =
      kind === "expense"
        ? `/dashboard/expenses?receipt=${id}`
        : `/dashboard/${kind === "invoice" ? "invoices" : kind === "estimate" ? "estimates" : "jobs"}/${id}`;
    this.items.push({ kind, id, label, path });
  }

  /** Wait for in-flight response reads; call once the recorded run is over. */
  async settle() {
    await Promise.all(this.pending);
  }

  count(kind: CreatedKind) {
    return this.items.filter((i) => i.kind === kind).length;
  }

  /** Warn when the run created fewer things than the script meant to (so cleanup may miss some). */
  async expectCount(kind: CreatedKind, n: number) {
    await this.settle();
    const got = this.count(kind);
    if (got < n) {
      console.warn(`WARNING: expected to track ${n} ${kind}(s) but only captured ${got}. Check for leftovers by hand.`);
    }
  }
}

type Failure = { item: CreatedItem; reason: string };

/** Per-step wait during cleanup: a stuck deletion is reported after this, not after a minute. */
const CLEANUP_TIMEOUT_MS = 15_000;

/** Run `act`, wait for the app's DELETE call, and require it to succeed (a 404 means already gone). */
async function deleteVia(page: Page, pathRegex: RegExp, act: () => Promise<void>) {
  const response = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && pathRegex.test(new URL(r.url()).pathname),
    { timeout: CLEANUP_TIMEOUT_MS },
  );
  // If `act` throws first, nobody awaits `response`; its later timeout must not become an unhandled rejection.
  response.catch(() => {});
  await act();
  const r = await response;
  if (!r.ok() && r.status() !== 404) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`DELETE answered ${r.status()}${body?.error ? `: ${body.error}` : ""}`);
  }
}

async function deleteDocument(page: Page, baseUrl: string, item: CreatedItem) {
  const nav = await page.goto(`${baseUrl}${item.path}`);
  if (nav?.status() === 404) return;
  const deleteButton = page.getByRole("button", { name: "Delete", exact: true });
  await deleteButton.waitFor();

  // An estimate the client signed was converted to an invoice by the app itself (not by a click the
  // run made), so the run may not have tracked it. Delete whatever invoice it links to first.
  if (item.kind === "estimate") {
    const hrefs = await page
      .locator('a[href^="/dashboard/invoices/"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    const linked = new Set<string>();
    for (const href of hrefs) {
      const m = new RegExp(`^/dashboard/invoices/(${UUID})`).exec(href);
      if (m) linked.add(m[1]);
    }
    for (const id of linked) {
      await deleteDocument(page, baseUrl, {
        kind: "invoice",
        id,
        label: "invoice converted from the estimate",
        path: `/dashboard/invoices/${id}`,
      });
      console.log(`Cleanup: also deleted the invoice converted from this estimate (${id}).`);
    }
    if (linked.size > 0) {
      await page.goto(`${baseUrl}${item.path}`);
      await deleteButton.waitFor();
    }
  }

  // An invoice with payments can't be deleted, and removing the last payment leaves it "sent",
  // which is locked too. So: remove each payment, then set it back to Draft, then delete.
  const paymentCard = page.locator('[data-slot="card"]').filter({ hasText: "Payment History" });
  for (let i = 0; i < 10; i++) {
    const trash = paymentCard.locator("button.text-destructive");
    if ((await trash.count()) === 0) break;
    await deleteVia(page, new RegExp(`^/api/documents/${item.id}/payments/${UUID}$`), async () => {
      await trash.first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Remove payment", exact: true }).click();
    });
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.waitForTimeout(400);
  }

  if (await deleteButton.isDisabled()) {
    const status = page.getByRole("combobox").filter({ hasText: /^\s*(sent|draft)\s*$/i }).first();
    await status.click();
    await page.getByRole("option", { name: "Draft", exact: true }).click();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).some(
          (b) => b.textContent?.trim() === "Delete" && b.disabled,
        ),
    );
  }

  await deleteVia(page, new RegExp(`^/api/documents/${item.id}$`), async () => {
    await deleteButton.click();
    await page.getByRole("dialog").getByRole("button", { name: /^delete (progress invoice|invoice|estimate)$/i }).click();
  });
}

async function deleteExpense(page: Page, baseUrl: string, item: CreatedItem) {
  await page.goto(`${baseUrl}${item.path}`);
  const drawer = page.getByRole("dialog");
  // The Expenses page opens that receipt's drawer from ?receipt=<id>; if it never opens, the id is gone.
  const opened = await drawer.waitFor({ timeout: 10_000 }).then(
    () => true,
    () => false,
  );
  if (!opened) return;
  await deleteVia(page, new RegExp(`^/api/receipts/${item.id}$`), () =>
    drawer.getByRole("button", { name: "Delete", exact: true }).click(),
  );
}

async function deleteJob(page: Page, baseUrl: string, item: CreatedItem) {
  const nav = await page.goto(`${baseUrl}${item.path}`);
  if (nav?.status() === 404) return;
  const deleteButton = page.getByRole("button", { name: "Delete", exact: true }).first();
  await deleteButton.waitFor();
  await deleteVia(page, new RegExp(`^/api/jobs/${item.id}$`), async () => {
    await deleteButton.click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  });
}

/**
 * Unrecorded: sign in again and delete exactly what `tracker` captured, through the UI.
 * Order matters: invoices and estimates (payments first), then expenses, then jobs (a job
 * with a paid invoice can't be deleted). Never throws. Returns how many items could not be
 * deleted, after printing a warning that names each one.
 */
export async function cleanupCreated(
  browser: Browser,
  tracker: CreatedTracker,
  creds: DemoCreds,
): Promise<number> {
  await tracker.settle().catch(() => {});
  if (tracker.items.length === 0) {
    console.log("Cleanup: the run created nothing, so there is nothing to delete.");
    return 0;
  }
  const rank: Record<CreatedKind, number> = { invoice: 0, estimate: 1, expense: 2, job: 3 };
  const todo = [...tracker.items].sort((a, b) => rank[a.kind] - rank[b.kind]);
  const failures: Failure[] = [];
  let deleted = 0;

  let context: BrowserContext | null = null;
  try {
    context = await newPhoneContext(browser);
    const page = await context.newPage();
    page.setDefaultTimeout(CLEANUP_TIMEOUT_MS);
    await signIn(page, creds, false);
    for (const item of todo) {
      try {
        if (item.kind === "invoice" || item.kind === "estimate") await deleteDocument(page, creds.baseUrl, item);
        else if (item.kind === "expense") await deleteExpense(page, creds.baseUrl, item);
        else await deleteJob(page, creds.baseUrl, item);
        deleted++;
      } catch (err) {
        failures.push({ item, reason: err instanceof Error ? err.message.split("\n")[0] : String(err) });
      }
    }
  } catch (err) {
    // Sign-in itself failed: nothing was attempted.
    const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
    for (const item of todo.slice(deleted + failures.length)) {
      failures.push({ item, reason: `could not sign in: ${reason}` });
    }
  } finally {
    await context?.close().catch(() => {});
  }

  if (failures.length === 0) {
    console.log(`Cleanup: deleted ${deleted} item(s) the run created.`);
    return 0;
  }
  const bar = "!".repeat(70);
  console.warn(
    `\n${bar}\nLEFT BEHIND: cleanup could NOT delete ${failures.length} of ${todo.length} item(s) the run created.\nThey are in the demo account (which shares the production database). Delete them by hand\n(invoices first, then the job; exit code ${CLEANUP_INCOMPLETE_EXIT}):\n`,
  );
  for (const { item, reason } of failures) {
    console.warn(`  - ${item.kind} "${item.label}": ${creds.baseUrl}${item.path}\n      ${reason}`);
  }
  console.warn(`${bar}\n`);
  return failures.length;
}

/** Exit code for "the video was recorded, but cleanup left something behind". */
export const CLEANUP_INCOMPLETE_EXIT = 3;

/**
 * The shared main(): launch, run the recording, then ALWAYS run the unrecorded cleanup (also
 * after a failed recording, so a half-made job or invoice is removed). Exit code: 0 ok,
 * 1 the recording failed, CLEANUP_INCOMPLETE_EXIT (3) recorded but something was left behind.
 */
export async function runDemo(
  creds: DemoCreds,
  record: (browser: Browser, tracker: CreatedTracker) => Promise<void>,
) {
  const browser = await launchBrowser();
  const tracker = new CreatedTracker();
  try {
    await record(browser, tracker);
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
  } finally {
    let left = 0;
    try {
      left = await cleanupCreated(browser, tracker, creds);
    } catch (err) {
      // cleanupCreated is written not to throw; if it somehow does, say what is unaccounted for.
      left = tracker.items.length;
      console.error(`Cleanup crashed (${err instanceof Error ? err.message : err}). Check the demo account by hand for:`);
      for (const item of tracker.items) console.error(`  - ${item.kind} "${item.label}": ${creds.baseUrl}${item.path}`);
    }
    await browser.close().catch(() => {});
    if (left > 0 && !process.exitCode) process.exitCode = CLEANUP_INCOMPLETE_EXIT;
  }
}

/**
 * Hide controls whose (short) text matches `pattern` on every page of the context, now and
 * as the page re-renders. For recordings that must not show certain features: the controls
 * are only hidden, never clicked.
 */
export async function hideControls(context: BrowserContext, pattern: RegExp) {
  await context.addInitScript(
    ({ source, flags }) => {
      const re = new RegExp(source, flags);
      const sweep = () => {
        document.querySelectorAll("button, a, [role=button], [role=menuitem]").forEach((el) => {
          const text = (el.textContent ?? "").trim();
          if (text.length > 0 && text.length < 40 && re.test(text)) (el as HTMLElement).style.display = "none";
        });
      };
      new MutationObserver(sweep).observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      document.addEventListener("DOMContentLoaded", sweep);
    },
    { source: pattern.source, flags: pattern.flags },
  );
}

/** Glide to a date input and set it (type="date" inputs take an ISO value via fill, not key presses). */
export async function fillDate(page: Page, target: Locator, iso: string) {
  await moveTo(page, target);
  await target.click();
  await target.fill(iso);
  await pause(page);
}
