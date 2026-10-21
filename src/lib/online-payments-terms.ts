// The online-payments disclosure, in ONE place so the confirmation dialog, the Settings card,
// the FAQ and the tests can not drift apart. Import-free so it can be unit-tested with
// `node --test`. The wording is the owner's own; it is not legal advice - the Terms of Service
// text that goes with it is a draft for a lawyer (docs/legal-drafts/).

// The Stripe fee numbers, kept in one place. Stripe can change them: when it does, change them
// here and re-check the draft terms (a test fails if the draft and these drift apart).
export const STRIPE_FEES = {
  domesticCard: "2.9% + CA$0.30",
  internationalExtra: "0.8%",
  disputeReceived: "CA$15",
  disputeContested: "CA$15",
} as const;

const SELLER_SENTENCES =
  "You are the seller. Card payments go to your own Stripe account, and Stripe is your payment processor.";

// What TaxSnap does with the fee: an expense with no tax (a Stripe fee has no HST, so there is no input
// tax credit). Sits right after the fee numbers wherever they are shown.
export const FEE_RECORDING_SENTENCE =
  "Fees are recorded as an expense without tax. Check your Stripe statement if tax is shown.";

// The Terms page's "Records and taxes" sentence about the fee (replaces "shown for information only").
export const FEE_EXPENSE_HST_SENTENCE =
  "Stripe's processing fee is recorded as an expense with no tax and is not part of your HST totals.";

export const FEE_SENTENCE =
  `Stripe's fee is ${STRIPE_FEES.domesticCard} per domestic card payment, plus ${STRIPE_FEES.internationalExtra} for international cards. ` +
  FEE_RECORDING_SENTENCE;

export const DISPUTE_SENTENCES =
  `Cardholders can dispute a card payment (a chargeback). Stripe charges ${STRIPE_FEES.disputeReceived} when a dispute is received ` +
  `and another ${STRIPE_FEES.disputeContested} if you contest it (refunded if you win). If you lose, the payment is taken back.`;

export const RESPONSIBILITY_SENTENCE =
  "You handle disputes and refunds in your Stripe Dashboard. TaxSnap records the outcome in your books but does not handle or contest disputes or refunds, and is not responsible for them.";

export const PRICING_SENTENCE = "See Stripe's pricing page for current fees.";

// The fee and dispute wording alone - what the FAQ and the draft terms quote.
export const FEE_AND_DISPUTE_WORDING = [
  FEE_SENTENCE,
  DISPUTE_SENTENCES,
  RESPONSIBILITY_SENTENCE,
  PRICING_SENTENCE,
].join(" ");

// What the owner ticks in the confirmation dialog.
export const ONLINE_PAYMENTS_DISCLOSURE = `${SELLER_SENTENCES} ${FEE_AND_DISPUTE_WORDING}`;

export const ONLINE_PAYMENTS_AGREE_LABEL = "I understand and agree";

// The same points as separate lines, for the Online payments card.
export const ONLINE_PAYMENTS_DISCLOSURE_SHORT = [
  SELLER_SENTENCES,
  FEE_SENTENCE,
  DISPUTE_SENTENCES,
  RESPONSIBILITY_SENTENCE,
  PRICING_SENTENCE,
] as const;

export const TERMS_REQUIRED_CODE = "TERMS_REQUIRED" as const;
export const TERMS_REQUIRED_MESSAGE =
  "Please read and accept the online payments terms before connecting Stripe.";

// What POST /api/stripe/connect/start does about the acceptance:
//  - "already"  : accepted before, carry on
//  - "accept"   : the request says the box was ticked, record it now and carry on
//  - "required" : refuse
export function termsDecision(input: {
  acceptedAt: string | null | undefined;
  acceptTerms: unknown;
}): "already" | "accept" | "required" {
  if (input.acceptedAt) return "already";
  return input.acceptTerms === true ? "accept" : "required";
}
