import type Stripe from "stripe";

// Stripe's processing fee for a payment, from the charge's balance transaction. Kept out of
// stripe-connect.ts (which uses `@/` imports) so it can be unit-tested with `node --test`.
//
// A direct charge lives on the CONNECTED account, so the read must carry `stripeAccount`: without it the
// platform account answers resource_missing. Cents become dollars here and nowhere else.
//
// Returns null when there is no fee TO READ YET - and that is normal, not an error: Stripe attaches the
// balance transaction about 3 seconds after the charge succeeds (and then sends charge.updated), so a read
// made the instant the payment completes finds `balance_transaction` null. Callers retry / wait for
// charge.updated (online-payments.ts). A real Stripe error is thrown.
type PaymentIntentReader = Pick<Stripe, "paymentIntents">;

export async function fetchPaymentFee(
  stripe: PaymentIntentReader,
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
