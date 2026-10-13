/**
 * Generates the fake receipt used by the receipt-scan recording:
 *   scripts/record-demo/assets/receipt-sample.png   a clean receipt, rendered from HTML with Playwright
 *   scripts/record-demo/assets/receipt-sample.json  the figures printed on it (the recording checks the AI's read against these)
 *
 * Everything on it is fictional: "Maple Hardware & Supply", Mississauga ON, a placeholder HST number,
 * four items, HST at 13% (rounded to the cent) and the total. The date is today, written with the
 * month name so the scanner never has to guess day/month order.
 *
 * The assets folder is git-ignored; nothing here is committed.
 *
 * Run:  npm run record:demo:make-receipt   (the receipt-scan script runs this itself if the PNG is missing)
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ASSETS_DIR = path.join(import.meta.dirname, "assets");
const PNG = path.join(ASSETS_DIR, "receipt-sample.png");
const JSON_FILE = path.join(ASSETS_DIR, "receipt-sample.json");

const MERCHANT = "Maple Hardware & Supply";
// Cents, so the HST maths is exact: no floating-point drift on the printed figures.
const ITEMS: [string, number][] = [
  ["Interior latex paint 4L", 3899],
  ["Brush set 3pk", 1249],
  ["Painter's tape", 699],
  ["Canvas drop cloth", 950],
];

const subtotal = ITEMS.reduce((sum, [, cents]) => sum + cents, 0);
const tax = Math.round(subtotal * 0.13);
const total = subtotal + tax;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const date = new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; padding: 24px; background: #e7e5e4; }
  #receipt { width: 340px; box-sizing: border-box; padding: 28px 24px 32px; background: #fff; color: #1c1917;
    font: 14px/1.5 "Courier New", Courier, monospace; }
  .c { text-align: center; } .b { font-weight: 700; } .big { font-size: 18px; }
  .row { display: flex; justify-content: space-between; gap: 12px; }
  hr { border: 0; border-top: 1px dashed #78716c; margin: 12px 0; }
  .small { font-size: 12px; color: #44403c; }
</style></head><body>
<div id="receipt">
  <div class="c b big">${MERCHANT.replace("&", "&amp;")}</div>
  <div class="c small">1450 Dundas Street West<br>Mississauga, ON L5C 1E2<br>Tel (905) 555-0142<br>HST# 000000000 RT0001</div>
  <hr>
  <div class="row"><span>${date}</span><span>Reg 02 &nbsp; #004817</span></div>
  <hr>
  ${ITEMS.map(([name, cents]) => `<div class="row"><span>${name.replace("'", "&#39;")}</span><span>${money(cents)}</span></div>`).join("\n  ")}
  <hr>
  <div class="row"><span>Subtotal</span><span>${money(subtotal)}</span></div>
  <div class="row"><span>HST 13%</span><span>${money(tax)}</span></div>
  <div class="row b big"><span>TOTAL</span><span>${money(total)}</span></div>
  <hr>
  <div class="c small">Paid by debit<br>Thank you for shopping local!</div>
</div>
</body></html>`;

fs.mkdirSync(ASSETS_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 420, height: 700 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.locator("#receipt").screenshot({ path: PNG });
} finally {
  await browser.close();
}
fs.writeFileSync(
  JSON_FILE,
  JSON.stringify(
    { merchant: MERCHANT, subtotal: subtotal / 100, tax: tax / 100, total: total / 100, date },
    null,
    2,
  ),
);
console.log(`Wrote ${PNG}\n  ${MERCHANT}: subtotal ${money(subtotal)}, HST ${money(tax)}, total ${money(total)}`);
