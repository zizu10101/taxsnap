// How a payment row reads in a list. Stripe refunds and lost disputes are stored as NEGATIVE
// payments (see online-refunds.ts); everything else is money in.

export const PAYMENT_DISPUTED_LABEL = "Payment disputed";

export type PaymentKind = "payment" | "refund" | "dispute_lost";

export function paymentKind(payment: { source?: string | null; amount: number }): PaymentKind {
  if (payment.source === "stripe_refund") return "refund";
  if (payment.source === "stripe_dispute") return "dispute_lost";
  return "payment";
}

// null for an ordinary payment.
export function paymentKindLabel(payment: { source?: string | null; amount: number }): string | null {
  const kind = paymentKind(payment);
  return kind === "refund" ? "Refund" : kind === "dispute_lost" ? "Dispute lost" : null;
}
