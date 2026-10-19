// Runs once when the Next.js server starts. Today it only prints the dev-time Stripe
// key check (see lib/stripe-startup.ts); it does nothing in production.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { logStripeStartup } = await import("@/lib/stripe-startup");
    await logStripeStartup();
  }
}
