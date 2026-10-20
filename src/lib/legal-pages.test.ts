import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGAL_CONTACT_EMAIL,
  PRIVACY_LAST_UPDATED,
  PRIVACY_VERSION,
  TERMS_LAST_UPDATED,
  TERMS_VERSION,
} from "./legal-versions.ts";
import { RESPONSIBILITY_SENTENCE } from "./online-payments-terms.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const terms = read("../app/terms/page.tsx");
const privacy = read("../app/privacy/page.tsx");

test("both legal pages are drafts: noindex, and not in the sitemap", () => {
  for (const src of [terms, privacy]) assert.match(src, /robots: \{ index: false \}/);
  const sitemap = read("../app/sitemap.ts");
  assert.doesNotMatch(sitemap, /\/terms|\/privacy/);
});

test("versions and dates exist and the pages show them", () => {
  assert.ok(TERMS_VERSION && PRIVACY_VERSION && TERMS_LAST_UPDATED && PRIVACY_LAST_UPDATED);
  assert.match(terms, /TERMS_VERSION/);
  assert.match(privacy, /PRIVACY_VERSION/);
  assert.ok(LEGAL_CONTACT_EMAIL, "one contact constant, set in legal-versions.ts");
  assert.doesNotMatch(terms + privacy, /info@/, "no hard-coded address in the pages");
  assert.match(terms, /LEGAL_CONTACT_EMAIL/);
  assert.match(privacy, /LEGAL_CONTACT_EMAIL/);
});

test("the terms reuse the online payments wording instead of restating it", () => {
  assert.match(terms, /RESPONSIBILITY_SENTENCE/);
  assert.match(terms, /DISPUTE_SENTENCES/);
  assert.match(terms, /FEE_SENTENCE/);
  assert.match(RESPONSIBILITY_SENTENCE, /does not handle or contest disputes or refunds/);
  assert.doesNotMatch(terms, /2\.9%|CA\$(0\.|15)/, "fee numbers stay in online-payments-terms.ts");
  assert.match(terms, /id="online-payments"/);
});

test("the terms cover the required topics", () => {
  for (const t of [
    /not an accountant, tax advisor or lawyer/,
    /AI can be wrong/,
    /Free and Pro plans/,
    /Created with TaxSnap/,
    /plus HST/,
    /Limitation of liability/,
    /Termination/,
    /Changes to these terms/,
    /Online payments/,
    /Ontario/,
  ]) {
    assert.match(terms, t);
  }
});

test("the privacy policy names the real providers, PIPEDA, and says what the code supports", () => {
  for (const t of [/Supabase/, /Vercel/, /Gemini/, /Stripe/, /Resend/, /PIPEDA/, /under 18/, /Commissioner/]) {
    assert.match(privacy, t);
  }
  assert.match(privacy, /do not use advertising or analytics cookies/);
});

test("statement import is not described yet (re-add at launch)", () => {
  assert.doesNotMatch(terms + privacy, /card statement|statement import|statement pages|statement drafts|and statements/i);
});

test("revised decisions: liability floor, annual refund, staff access, deletion within 30 days", () => {
  assert.match(terms, /greater of the amount you paid us for TaxSnap in the 12 months before the claim and CA\$100/);
    assert.match(terms, /staff may access/i);
  assert.match(terms, /full refund within 14 days/);
  assert.match(privacy, /within 30 days/);
  assert.match(privacy, /export/i);
  assert.match(privacy, /staff may access/i);
});

test("no claims the code can not back up", () => {
  for (const src of [terms, privacy]) {
    assert.doesNotMatch(src, /bank-level|military|SOC ?2|ISO ?27001|we never share|never share your|100% secure/i);
  }
  // the app has no analytics/tracking dependency, which is what the cookies section says
  const pkg = read("../../package.json");
  assert.doesNotMatch(pkg, /analytics|posthog|mixpanel|sentry|gtag|plausible/i);
});

test("links: the Online payments dialog and the sign-in page point at both pages", () => {
  const dialog = read("../components/settings/online-payments-terms-dialog.tsx");
  assert.match(dialog, /href="\/terms#online-payments"/);
  assert.match(dialog, /href="\/privacy"/);
  const auth = read("../app/auth/auth-form.tsx");
  assert.match(auth, /href="\/terms"/);
  assert.match(auth, /href="\/privacy"/);
});
