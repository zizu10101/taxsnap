import type { Metadata, MetadataRoute } from "next";
import { PRIVACY_LAST_UPDATED, TERMS_LAST_UPDATED } from "./legal-versions.ts";

// Everything search engines and AI crawlers read from us that is not page copy:
// robots.txt, the sitemap, per-page social metadata and the JSON-LD blocks.
// Pure (no Next runtime imports) so `npm test` can exercise it directly.

export const SITE_NAME = "TaxSnap";
export const SITE_TITLE = "TaxSnap — Snap receipts, sort your tax write-offs";
export const SITE_DESCRIPTION =
  "TaxSnap helps self-employed contractors, owner-operators, and freelancers snap photos of receipts, auto-categorize tax write-offs with AI, and export clean data for tax season.";

// The public origin every canonical, og:url, sitemap URL, robots Sitemap line and
// JSON-LD block uses: the www host, because the bare domain redirects to it. A
// constant on purpose - NEXT_PUBLIC_APP_URL is NOT read here. It is set to
// http://localhost:3000 in .env.local and unset in production, and it still drives
// the email, Stripe and auth links elsewhere; neither value belongs in what search
// engines index.
export const SITE_URL = "https://www.gettaxsnap.ca";

export function siteUrl(): string {
  return SITE_URL;
}

// ---------------------------------------------------------------- robots.txt

// Signed-in app, sign-in and the cookie-session portals. Prefix matches, so
// "/client" also covers "/client-login" and "/employee" covers "/employee-login";
// the longer forms are listed anyway so the intent reads plainly.
// /invoice/<token> and /sign/<token> are deliberately NOT here: they carry
// `noindex` (metadata + X-Robots-Tag), and a crawler blocked by robots.txt can
// never see that tag.
export const ROBOTS_DISALLOW = [
  "/api/",
  "/dashboard",
  "/billing",
  "/auth",
  "/onboarding",
  "/admin",
  "/accountant",
  "/accountant-login",
  "/client",
  "/client-login",
  "/employee",
  "/employee-login",
];

// Named explicitly so the policy is on record. A crawler with its own group
// ignores the `*` group completely, so each one repeats the same disallow list.
export const AI_CRAWLERS = ["GPTBot", "ClaudeBot", "PerplexityBot", "Google-Extended"];

export function buildRobots(base: string = siteUrl()): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ROBOTS_DISALLOW },
      ...AI_CRAWLERS.map((userAgent) => ({
        userAgent,
        allow: "/",
        disallow: ROBOTS_DISALLOW,
      })),
    ],
    sitemap: `${base}/sitemap.xml`,
  };
}

// ------------------------------------------------------------------- sitemap

// `lastModified` is only given where a real date exists (the legal pages carry
// one). A build-time `new Date()` on every URL told crawlers everything changed
// on every deploy.
export function buildSitemapEntries(
  base: string,
  featureHrefs: string[],
  howToSlugs: string[],
): MetadataRoute.Sitemap {
  const legalDate = (label: string) => new Date(`${label} 00:00:00 UTC`);
  return [
    { url: base },
    { url: `${base}/salons` },
    { url: `${base}/features` },
    { url: `${base}/faq` },
    { url: `${base}/how-to` },
    { url: `${base}/terms`, lastModified: legalDate(TERMS_LAST_UPDATED) },
    { url: `${base}/privacy`, lastModified: legalDate(PRIVACY_LAST_UPDATED) },
    ...howToSlugs.map((slug) => ({ url: `${base}/how-to/${slug}` })),
    ...featureHrefs.map((href) => ({ url: `${base}${href}` })),
  ];
}

// ------------------------------------------------------------ page metadata

// The generated card (app/opengraph-image.tsx). Next only attaches that file to
// pages in its own (root) segment: a sub-page that sets `openGraph` loses the
// image unless it is named here (confirmed in the production build output).
export const OG_IMAGE_PATH = "/opengraph-image";

// Title, description, canonical and the social tags together. A page that sets
// its own `openGraph` replaces the layout's whole object, so every page goes
// through this to keep siteName/type/locale, the image and the Twitter card.
export function pageMetadata(opts: {
  title: string;
  description?: string;
  path: string;
}): Metadata {
  const { title, description, path } = opts;
  return {
    title,
    ...(description ? { description } : {}),
    alternates: { canonical: path },
    openGraph: {
      title,
      ...(description ? { description } : {}),
      url: path,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_CA",
      images: [{ url: OG_IMAGE_PATH, width: 1200, height: 630, alt: SITE_TITLE }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      ...(description ? { description } : {}),
      images: [OG_IMAGE_PATH],
    },
  };
}

// ------------------------------------------------------------------- JSON-LD

export function organizationJsonLd(base: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: base,
    logo: `${base}/logo-mark.png`,
    email: "info@gettaxsnap.ca",
  };
}

export function websiteJsonLd(base: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: base,
  };
}

// Deliberately no `offers`: pricing lives in one place (the Pricing section).
export function softwareApplicationJsonLd(base: string) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: base,
    description: SITE_DESCRIPTION,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any (web browser, installable as an app)",
  };
}

export function faqPageJsonLd(items: { question: string; answer: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };
}

// "<" is escaped so no string in the data can close the script tag.
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
