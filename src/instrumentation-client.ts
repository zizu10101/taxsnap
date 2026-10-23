// Browser-side Sentry. Does nothing unless NEXT_PUBLIC_SENTRY_DSN is set and this build is the
// production deployment (next.config.ts bakes in NEXT_PUBLIC_SENTRY_ENV / _RELEASE from Vercel).
import { resolveSentryConfig } from "@/lib/sentry-privacy";

const env = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  vercelEnv: process.env.NEXT_PUBLIC_SENTRY_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
};

if (resolveSentryConfig(env)) {
  void import("@/lib/sentry-init").then(({ initSentry }) => initSentry(env));
}
