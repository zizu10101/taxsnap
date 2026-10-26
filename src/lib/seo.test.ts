import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AI_CRAWLERS,
  ROBOTS_DISALLOW,
  buildRobots,
  buildSitemapEntries,
  faqPageJsonLd,
  organizationJsonLd,
  pageMetadata,
  serializeJsonLd,
  SITE_URL,
  siteUrl,
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "./seo.ts";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const BASE = "https://www.gettaxsnap.ca";
// faq-items.ts imports through the "@/" alias, which plain node can not resolve.
const SAMPLE_FAQ = [
  { question: "Is it easy?", answer: "Yes." },
  { question: "Does it work offline?", answer: "Mostly <b>yes</b>." },
];

type Rule = { userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[] };
const rules = () => buildRobots(BASE).rules as Rule[];
const blocked = (rule: Rule, path: string) =>
  ([] as string[]).concat(rule.disallow ?? []).some((d) => path.startsWith(d));

test("siteUrl is the www constant whatever NEXT_PUBLIC_APP_URL says", () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  try {
    for (const value of [undefined, "http://localhost:3000", "https://gettaxsnap.ca", "https://example.com/"]) {
      if (value === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = value;
      assert.equal(SITE_URL, BASE);
      assert.equal(siteUrl(), BASE);
      assert.equal(buildRobots().sitemap, `${BASE}/sitemap.xml`);
    }
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = saved;
  }
});

test("no sitemap URL, canonical, og:url or JSON-LD URL uses the bare domain or localhost", () => {
  const bad = /localhost|127\.0\.0\.1|https?:\/\/gettaxsnap\.ca/;
  const site = siteUrl();
  const urls = buildSitemapEntries(site, ["/features/reports"], ["record-payment"]).map((e) => e.url);
  const m = pageMetadata({ title: "T", path: "/faq" });
  const absolute = [
    ...urls,
    buildRobots().sitemap as string,
    JSON.stringify([organizationJsonLd(site), websiteJsonLd(site), softwareApplicationJsonLd(site)]),
  ];
  for (const text of absolute) {
    assert.doesNotMatch(text, bad, text);
    assert.match(text, /https:\/\/www\.gettaxsnap\.ca/);
  }
  // canonical and og:url are paths, resolved against metadataBase (= siteUrl())
  assert.equal(m.alternates?.canonical, "/faq");
  assert.equal((m.openGraph as { url: string }).url, "/faq");
  const layout = read("../app/layout.tsx");
  assert.match(layout, /metadataBase:\s*new URL\(siteUrl\(\)\)/);
  assert.doesNotMatch(layout + read("../app/sitemap.ts") + read("../app/robots.ts") + read("./seo.ts"), /process\.env\.NEXT_PUBLIC_APP_URL\s*\|\||process\.env\.NEXT_PUBLIC_APP_URL\)/);
});

test("robots.txt: * and the four AI crawlers each get an allow-all group with the same disallow list", () => {
  const all = rules();
  const star = all.find((r) => r.userAgent === "*")!;
  assert.ok(star);
  for (const bot of ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"]) {
    assert.ok(AI_CRAWLERS.includes(bot), bot);
    const rule = all.find((r) => r.userAgent === bot);
    assert.ok(rule, `${bot} has its own group`);
    assert.equal(rule.allow, "/");
    // a bot with its own group ignores "*", so the list must be repeated
    assert.deepEqual(rule.disallow, star.disallow);
  }
  assert.equal(buildRobots(BASE).sitemap, `${BASE}/sitemap.xml`);
});

test("robots.txt blocks the app, API and portals but leaves public pages and token pages crawlable", () => {
  for (const rule of rules()) {
    for (const path of [
      "/api/receipts", "/dashboard", "/dashboard/jobs", "/auth", "/onboarding", "/billing",
      "/accountant", "/accountant-login/x", "/client/documents", "/client-login/x",
      "/employee/hours", "/employee-login/x",
    ]) {
      assert.ok(blocked(rule, path), `${rule.userAgent} should block ${path}`);
    }
    // token pages must stay crawlable or the noindex on them is never seen
    for (const path of ["/", "/faq", "/features", "/features/invoicing", "/features/accountant-export", "/how-to", "/salons", "/terms", "/privacy", "/invoice/abc123", "/sign/abc123"]) {
      assert.ok(!blocked(rule, path), `${rule.userAgent} should not block ${path}`);
    }
  }
  assert.ok(!ROBOTS_DISALLOW.some((d) => d === "/" || d.startsWith("/invoice") || d.startsWith("/sign")));
});

test("token pages are noindex in their metadata and in an X-Robots-Tag header", () => {
  for (const file of ["../app/invoice/[token]/page.tsx", "../app/sign/[token]/page.tsx"]) {
    assert.match(read(file), /robots:\s*\{\s*index:\s*false/);
  }
  const config = read("../../next.config.ts");
  assert.match(config, /X-Robots-Tag/);
  assert.match(config, /\/invoice\/:path\*/);
  assert.match(config, /\/sign\/:path\*/);
  for (const file of ["../app/auth/page.tsx", "../app/onboarding/page.tsx", "../app/(app)/layout.tsx"]) {
    assert.match(read(file), /index:\s*false/, file);
  }
});

test("sitemap: every public page once, absolute, none of the private routes", () => {
  const entries = buildSitemapEntries(BASE, ["/features/invoicing", "/features/reports"], ["record-payment"]);
  const urls = entries.map((e) => e.url);
  for (const path of ["", "/salons", "/features", "/faq", "/how-to", "/terms", "/privacy", "/how-to/record-payment", "/features/invoicing", "/features/reports"]) {
    assert.ok(urls.includes(`${BASE}${path}`), path || "home");
  }
  assert.equal(new Set(urls).size, urls.length);
  for (const url of urls) {
    assert.ok(url.startsWith(BASE));
    assert.doesNotMatch(url, /\/(api|dashboard|auth|onboarding|billing|invoice|sign|admin|accountant|client|employee)/);
  }
});

test("sitemap: lastModified is only a real date (legal pages), never the build time", () => {
  const entries = buildSitemapEntries(BASE, ["/features/invoicing"], ["record-payment"]);
  const dated = entries.filter((e) => e.lastModified !== undefined).map((e) => e.url);
  assert.deepEqual(dated.sort(), [`${BASE}/privacy`, `${BASE}/terms`]);
  const terms = entries.find((e) => e.url.endsWith("/terms"))!;
  assert.equal(new Date(terms.lastModified!).toISOString(), "2026-10-22T00:00:00.000Z");
});

test("pageMetadata gives every page a canonical, Open Graph with siteName, and a Twitter card", () => {
  const m = pageMetadata({ title: "T", description: "D", path: "/faq" });
  assert.equal(m.alternates?.canonical, "/faq");
  assert.equal((m.openGraph as { url: string }).url, "/faq");
  assert.equal((m.openGraph as { siteName: string }).siteName, "TaxSnap");
  assert.equal((m.twitter as { card: string }).card, "summary_large_image");
  // a sub-page that sets its own openGraph would otherwise lose the root og:image
  assert.equal((m.openGraph as { images: { url: string }[] }).images[0].url, "/opengraph-image");
  assert.deepEqual((m.twitter as { images: string[] }).images, ["/opengraph-image"]);
  const bare = pageMetadata({ title: "T", path: "/x" });
  assert.ok(!("description" in bare));
  assert.ok(!("description" in (bare.openGraph as object)));
});

test("structured data: Organization, WebSite, SoftwareApplication (no price) and FAQPage", () => {
  const org = organizationJsonLd(BASE);
  const site = websiteJsonLd(BASE);
  const app = softwareApplicationJsonLd(BASE);
  assert.equal(org["@type"], "Organization");
  assert.equal(org.logo, `${BASE}/logo-mark.png`);
  assert.equal(site["@type"], "WebSite");
  assert.equal(app["@type"], "SoftwareApplication");
  assert.ok(!("offers" in app));
  assert.doesNotMatch(JSON.stringify([org, site, app]), /price|offers|\$\d|CAD|\bPro\b|\bFree\b/i);

  const faq = faqPageJsonLd(SAMPLE_FAQ);
  assert.equal(faq["@type"], "FAQPage");
  assert.equal(faq.mainEntity.length, 2);
  assert.equal(faq.mainEntity[0]["@type"], "Question");
  assert.equal(faq.mainEntity[0].name, "Is it easy?");
  assert.equal(faq.mainEntity[1]["acceptedAnswer"]["@type"], "Answer");
  assert.equal(faq.mainEntity[1].acceptedAnswer.text, SAMPLE_FAQ[1].answer);
});

test("serializeJsonLd can never close the script tag", () => {
  const out = serializeJsonLd({ a: "</script><b>" });
  assert.ok(!out.includes("<"));
  assert.deepEqual(JSON.parse(out), { a: "</script><b>" });
});

test("pages emit the JSON-LD: all four blocks on the homepage, FAQPage on /faq", () => {
  const home = read("../app/page.tsx");
  for (const call of [
    "organizationJsonLd(siteUrl())",
    "websiteJsonLd(siteUrl())",
    "softwareApplicationJsonLd(siteUrl())",
    "faqPageJsonLd(HOME_FAQ_ITEMS)",
  ]) {
    assert.ok(home.includes(`<JsonLd data={${call}} />`), call);
  }
  assert.ok(read("../app/faq/page.tsx").includes("<JsonLd data={faqPageJsonLd(SITE_FAQ_ITEMS)} />"));
});

test("FAQ answers are in the server-rendered HTML: <details>, question as a heading, no JS gate", () => {
  const src = read("../components/landing/faq-section.tsx");
  assert.doesNotMatch(src, /"use client"|useState|\{open &&/);
  assert.match(src, /<details/);
  assert.match(src, /<summary/);
  assert.match(src, /<h3[^>]*>\{item\.question\}<\/h3>/);
  assert.match(src, /<p>\{item\.answer\}<\/p>/);
});

test("every FAQ heading is a question, and the viewport can be zoomed", () => {
  const questions = [...read("./faq-items.ts").matchAll(/question:\s*"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(questions.length >= 10);
  for (const q of questions) assert.match(q, /\?$/, q);
  assert.doesNotMatch(read("../app/layout.tsx"), /maximumScale/);
});

test("pages that set their own Open Graph go through pageMetadata so siteName and the card survive", () => {
  for (const f of ["expense-tracking", "invoicing", "progress-billing", "jobs", "reports", "site-photos"]) {
    const src = read(`../app/features/${f}/page.tsx`);
    assert.match(src, /pageMetadata\(/, f);
    assert.doesNotMatch(src, /openGraph:/, f);
  }
});
