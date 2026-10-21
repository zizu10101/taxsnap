import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Which tax applies to TaxSnap's own subscription depends on the customer's address (Stripe Tax works it out), so
// customer-facing price text says "plus applicable taxes". HST on a contractor's own invoices, the HST estimates
// and the reports are a different thing and are untouched; only wording about the Pro price is pinned here.

// landing-header.tsx is the owner's own in-progress file (not edited here): its "+ HST" next to the Pro price is
// waiting for the owner. Remove it from this list once that line says "+ applicable taxes".
const PENDING_OWNER_EDIT = new Set(["components/landing/landing-header.tsx"]);

const BANNED = [/plus\s+HST/i, /\+\s*HST/, /excl(?:uding|usive|\.)?\s+(?:of\s+)?HST/i, /HST[- ]exclusive/i, /HST[- ]extra/i];

test("no customer-facing subscription price text says 'plus HST' or 'excl. HST'", () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name)) files.push(full);
    }
  };
  walk(root);
  assert.ok(files.length > 100, "the scan found the source tree");

  const hits: string[] = [];
  for (const file of files) {
    const rel = file.slice(root.length).split("\\").join("/");
    if (PENDING_OWNER_EDIT.has(rel)) continue;
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return; // comments are not customer-facing
        if (BANNED.some((re) => re.test(line))) hits.push(`${rel}:${i + 1}: ${t.slice(0, 100)}`);
      });
  }
  assert.deepEqual(hits, []);
});

test("the banned phrases do catch the old wording (the scan can fail)", () => {
  for (const old of ["Canadian dollars, plus HST.", "$29 CAD/mo + HST", "excl. HST", "excluding HST", "HST-exclusive"]) {
    assert.ok(BANNED.some((re) => re.test(old)), old);
  }
  for (const fine of ["plus applicable taxes", "Invoices excluded from HST", "Revenue before HST", "HST (13%)"]) {
    assert.ok(!BANNED.some((re) => re.test(fine)), fine);
  }
});

test("the price note is 'plus applicable taxes', in one shared constant, and the Terms use the same words", () => {
  // pricing-plans.ts uses @/ imports, so read the constant from source rather than import it.
  assert.match(read("./pricing-plans.ts"), /export const PLUS_TAXES_NOTE = "plus applicable taxes";/);
  assert.match(read("../components/landing/pricing-section.tsx"), /\{PLUS_TAXES_NOTE\}/);
  assert.match(read("../app/(app)/billing/pricing-cards.tsx"), /\{PLUS_TAXES_NOTE\}/);
  assert.match(read("../app/terms/page.tsx"), /Canadian dollars, plus applicable taxes\./);
});
