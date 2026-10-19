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

// Pro is the only paid plan.
export type BillingTier = "pro";
export type { BillingInterval };

// Pro has a monthly and an annual Stripe Price ($29/mo, $290/yr CAD, both
// excluding HST - Stripe Tax adds it at checkout). The annual env var is
// STRIPE_PRO_ANNUAL_PRICE_ID; STRIPE_PRO_YEARLY_PRICE_ID is the name this
// project used before, still read as a fallback so an existing deployment
// keeps working until the variable is renamed.
export const STRIPE_PRICE_IDS: Record<BillingTier, Record<BillingInterval, string>> = {
  pro: {
    monthly: process.env.STRIPE_PRO_PRICE_ID ?? "",
    yearly:
      process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? process.env.STRIPE_PRO_YEARLY_PRICE_ID ?? "",
  },
};
