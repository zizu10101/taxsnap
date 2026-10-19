import { getStripe } from "@/lib/stripe";
import { keyPrefix, logStripeError, shouldLogStripeStartup } from "@/lib/stripe-error";

// Development only: one line at server start saying which Stripe account the secret
// key belongs to, so a key from the wrong account (or a live key) is obvious before
// anything is clicked. Only the first 7 characters of the key are printed ("sk_test"
// or "sk_live") - never the rest. It is a single read-only call (GET /v1/account).
export async function logStripeStartup(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!shouldLogStripeStartup({ NODE_ENV: process.env.NODE_ENV, NEXT_RUNTIME: process.env.NEXT_RUNTIME }, key)) return;
  const prefix = keyPrefix(key!);
  try {
    const account = await getStripe().accounts.retrieveCurrent();
    const name = account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? "(no name)";
    console.info(
      `[stripe] dev key ${prefix}... belongs to ${account.id} "${name}" (${account.country}, ${account.default_currency})` +
        (prefix === "sk_live" ? "  <-- LIVE KEY in development: the Connect routes will refuse to run" : ""),
    );
  } catch (err) {
    console.info(`[stripe] dev key ${prefix}... could not be checked:`);
    logStripeError("startup accounts.retrieve", err);
  }
}
