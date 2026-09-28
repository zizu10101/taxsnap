import type { MetadataRoute } from "next";
import { FEATURE_PAGES } from "@/lib/feature-pages";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://gettaxsnap.ca";

// Every current public marketing route - the /features/* entries are
// built off FEATURE_PAGES (@/lib/feature-pages.ts), the same single
// source of truth the /features index grid and the header's Features
// dropdown already read from, so a future page added there needs no
// edit here either. Deliberately excludes /auth, /billing (both require
// a session) and the token-gated /invoice/[token], /sign/[token] pages -
// none of those are marketing content or meant to be indexed.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    { url: BASE_URL, lastModified: now },
    { url: `${BASE_URL}/salons`, lastModified: now },
    { url: `${BASE_URL}/features`, lastModified: now },
    ...FEATURE_PAGES.map((feature) => ({
      url: `${BASE_URL}${feature.href}`,
      lastModified: now,
    })),
  ];
}
