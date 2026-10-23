import * as Sentry from "@sentry/nextjs";
import { startSentry, type SentryEnv } from "@/lib/sentry-privacy";

// The only place Sentry.init is called (server via instrumentation.ts, browser via
// instrumentation-client.ts). All options and the privacy scrubbing live in sentry-privacy.ts;
// with no DSN, or outside the production deployment, nothing starts and this is a no-op.
export function initSentry(env: SentryEnv): boolean {
  return startSentry(env, (options) => Sentry.init(options as Parameters<typeof Sentry.init>[0]));
}
