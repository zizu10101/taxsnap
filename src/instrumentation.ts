// Runs once when the Next.js server starts. It starts Sentry (only when SENTRY_DSN is set and this
// is the production deployment - see lib/sentry-privacy.ts) and prints the dev-time Stripe key
// check (see lib/stripe-startup.ts), which does nothing in production.
export async function register() {
  if (process.env.SENTRY_DSN) {
    const { initSentry } = await import("@/lib/sentry-init");
    initSentry({
      dsn: process.env.SENTRY_DSN,
      vercelEnv: process.env.VERCEL_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    });
  }

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logStripeStartup } = await import("@/lib/stripe-startup");
    await logStripeStartup();
  }
}

// Errors Next.js catches in route handlers, server actions and server rendering. Without a DSN this
// returns before @sentry/nextjs is even loaded. (Not-found, redirect and 4xx are dropped in beforeSend.)
export async function onRequestError(...args: Parameters<typeof import("@sentry/nextjs").captureRequestError>) {
  if (!process.env.SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
