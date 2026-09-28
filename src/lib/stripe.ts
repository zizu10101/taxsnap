import Stripe from "stripe";
import type { BillingInterval } from "@/lib/database.types";

let stripeClient: Stripe | null = null;

// Lazily instantiated so the app can build/boot even before STRIPE_SECRET_KEY
// is configured (e.g. running the dashboard without billing set up yet).
export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

export type BillingTier = "basic" | "pro";
export type { BillingInterval };

// Nested per tier per interval - each tier now has a separate monthly and
// yearly Stripe Price, not one flat price each. BillingTier can no longer
// be derived via `keyof typeof STRIPE_PRICE_IDS` now that this nests, so
// it's declared explicitly above instead.
export const STRIPE_PRICE_IDS: Record<BillingTier, Record<BillingInterval, string>> = {
  basic: {
    monthly: process.env.STRIPE_BASIC_PRICE_ID ?? "",
    yearly: process.env.STRIPE_BASIC_YEARLY_PRICE_ID ?? "",
  },
  pro: {
    monthly: process.env.STRIPE_PRO_PRICE_ID ?? "",
    yearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID ?? "",
  },
};
