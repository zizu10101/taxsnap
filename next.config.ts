import type { NextConfig } from "next";
import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  // Pin the workspace root: the parent directory isn't a git repo, which
  // otherwise makes Next.js guess the wrong root for package-lock.json.
  turbopack: {
    root: path.join(__dirname),
  },
  // Read by instrumentation-client.ts: Sentry only runs in the browser of the production
  // deployment, and reports which commit it is. Local builds have no VERCEL_ENV -> "development".
  // Token pages are public by design but must never be indexed. `noindex` also lives in
  // each page's metadata; this header covers the response itself. Not disallowed in
  // robots.txt on purpose, or crawlers could not read the tag (see lib/seo.ts).
  async headers() {
    return ["/invoice/:path*", "/sign/:path*"].map((source) => ({
      source,
      headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
    }));
  },
  env: {
    NEXT_PUBLIC_SENTRY_ENV: process.env.VERCEL_ENV ?? "development",
    NEXT_PUBLIC_SENTRY_RELEASE: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
};

// Source maps are uploaded to Sentry only when all three are set (they are, on Vercel, once added
// to the project). Otherwise the config is exported untouched and the build is exactly as before.
const uploadSourceMaps = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT,
);

export default uploadSourceMaps
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      telemetry: false,
      silent: !process.env.CI,
      release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
      sourcemaps: { deleteSourcemapsAfterUpload: true },
    })
  : nextConfig;
