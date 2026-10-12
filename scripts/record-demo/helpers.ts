import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

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

export function newPhoneContext(browser: Browser, rawDir?: string) {
  return browser.newContext({
    ...PHONE_CONTEXT_OPTIONS,
    ...(rawDir ? { recordVideo: { dir: rawDir, size: { width: 390, height: 844 } } } : {}),
  });
}

/** Click an option of an opened dropdown by role, falling back to its visible text. */
export async function pickOption(page: Page, name: string) {
  const byRole = page.getByRole("option", { name, exact: true });
  const option = (await byRole.waitFor({ timeout: 3000 }).then(() => true, () => false))
    ? byRole
    : page.getByRole("listbox").getByText(name, { exact: true });
  await clickWithCursor(page, option);
}
