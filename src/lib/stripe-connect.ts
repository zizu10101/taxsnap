import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { connectKeyProblem } from "@/lib/connect-guard";
import { connectedAccountParams } from "@/lib/connect-status";

// Everything in here moves real money, so each entry point asks for its Stripe
// client through getConnectStripe(): it refuses a live key outside production
// (see lib/connect-guard.ts) before any Stripe call is made.
export function getConnectStripe(): { stripe: Stripe } | { error: string } {
  const problem = connectKeyProblem(process.env.STRIPE_SECRET_KEY, {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
  });
  if (problem) return { error: problem };
  return { stripe: getStripe() };
}

export function connectAppUrl(request: Request): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

// One new connected account per contractor, the "Standard-like" configuration the
// scoping report chose: the contractor gets the full Stripe Dashboard, Stripe
// collects their identity requirements and covers negative balances, and Stripe
// bills its processing fees to them (not to us). Stripe will not enable card_payments on its
// own: both capabilities must be requested together (Stripe: "Accounts do not currently
// support card_payments without transfers"). We only ever make DIRECT charges, so `transfers`
// is never used to move money - it is requested because Stripe requires it.
export function createConnectedAccount(
  stripe: Stripe,
  input: { userId: string; email: string | null; businessName: string | null },
): Promise<Stripe.Account> {
  return stripe.accounts.create(connectedAccountParams(input));
}

// Account Links are single-use and expire in minutes, so one is made per click and
// handed straight to the signed-in owner - never stored, never emailed.
export function createOnboardingLink(stripe: Stripe, accountId: string, appUrl: string) {
  return stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${appUrl}/api/stripe/connect/refresh`,
    return_url: `${appUrl}/api/stripe/connect/return`,
    collection_options: { fields: "eventually_due" },
  });
}

// Stripe's processing fee for a payment, from the charge's balance transaction -
// shown for information only, never used in any total.
export async function fetchPaymentFee(
  stripe: Stripe,
  paymentIntentId: string,
  accountId: string,
): Promise<{ fee: number; net: number; chargeId: string | null } | null> {
  const pi = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    { expand: ["latest_charge.balance_transaction"] },
    { stripeAccount: accountId },
  );
  const charge = pi.latest_charge;
  if (!charge || typeof charge === "string") return null;
  const bt = charge.balance_transaction;
  if (!bt || typeof bt === "string") return null;
  return { fee: bt.fee / 100, net: bt.net / 100, chargeId: charge.id };
}
