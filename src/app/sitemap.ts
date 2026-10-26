import type { MetadataRoute } from "next";
import { FEATURE_PAGES } from "@/lib/feature-pages";
import { availableHowToVideos } from "@/lib/how-to-videos-server";
import { buildSitemapEntries, siteUrl } from "@/lib/seo";

// Every public marketing route (the list lives in buildSitemapEntries, lib/seo.ts).
// The /features/* and /how-to/* entries come from FEATURE_PAGES and the published
// how-to videos, so a page added there needs no edit here. Deliberately excludes
// /auth, /billing and the token-gated /invoice/[token], /sign/[token] pages.
export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemapEntries(
    siteUrl(),
    FEATURE_PAGES.map((f) => f.href),
    availableHowToVideos().map((v) => v.slug),
  );
}
