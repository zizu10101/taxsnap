import Stripe from "stripe";

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

export const STRIPE_PRICE_IDS = {
  basic: process.env.STRIPE_BASIC_PRICE_ID ?? "",
  pro: process.env.STRIPE_PRO_PRICE_ID ?? "",
} as const;

export type BillingTier = keyof typeof STRIPE_PRICE_IDS;
