import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { connectKeyProblem } from "@/lib/connect-guard";
import { connectedAccountParams } from "@/lib/connect-status";
import { EXCESS_REFUND_FLAG } from "@/lib/online-refunds";

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

// ---- phase 4: reads used to re-fetch refunds and disputes (never trust the webhook payload) ----

export async function retrieveConnectCharge(stripe: Stripe, chargeId: string, accountId: string) {
  const charge = await stripe.charges.retrieve(chargeId, {}, { stripeAccount: accountId });
  return {
    id: charge.id,
    currency: charge.currency,
    payment_intent: typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null,
    metadata: charge.metadata,
  };
}

// Every refund of the charge (a charge can carry several partial ones), newest data from Stripe.
export async function listConnectRefunds(stripe: Stripe, chargeId: string, accountId: string) {
  const refunds: Stripe.Refund[] = [];
  for await (const refund of stripe.refunds.list({ charge: chargeId, limit: 100 }, { stripeAccount: accountId })) {
    refunds.push(refund);
  }
  return refunds.map((r) => ({
    id: r.id,
    amount: r.amount,
    status: r.status,
    created: r.created,
    currency: r.currency,
    metadata: r.metadata,
  }));
}

export async function retrieveConnectDispute(stripe: Stripe, disputeId: string, accountId: string) {
  const dispute = await stripe.disputes.retrieve(disputeId, { expand: ["balance_transactions"] }, { stripeAccount: accountId });
  return {
    id: dispute.id,
    charge: typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null,
    payment_intent:
      typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null,
    amount: dispute.amount,
    currency: dispute.currency,
    status: dispute.status as string,
    balance_transactions: dispute.balance_transactions.map((bt) => ({ fee: bt.fee })),
  };
}

// A refund this app already issued for the payment intent (marked with the excess metadata flag).
export async function findConnectExcessRefund(stripe: Stripe, paymentIntentId: string, accountId: string) {
  for await (const refund of stripe.refunds.list(
    { payment_intent: paymentIntentId, limit: 100 },
    { stripeAccount: accountId },
  )) {
    if (refund.metadata?.[EXCESS_REFUND_FLAG] === "1" && refund.status !== "failed" && refund.status !== "canceled") {
      return { id: refund.id };
    }
  }
  return null;
}

// The only Stripe WRITE in the refunds/disputes feature: returns the excess of a double payment to
// the payer, on the contractor's own account. Idempotent (key per payment intent) and flagged so the
// charge.refunded it triggers is not mirrored into the books.
export async function createConnectExcessRefund(
  stripe: Stripe,
  args: { paymentIntentId: string; accountId: string; cents: number; idempotencyKey: string; documentId: string },
) {
  const refund = await stripe.refunds.create(
    {
      payment_intent: args.paymentIntentId,
      amount: args.cents,
      reason: "duplicate",
      metadata: { [EXCESS_REFUND_FLAG]: "1", document_id: args.documentId },
    },
    { stripeAccount: args.accountId, idempotencyKey: args.idempotencyKey },
  );
  return { id: refund.id };
}
