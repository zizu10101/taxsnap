// What the Send menu says about "Copy link" on an invoice, depending on whether the client can
// pay from that link. Pure and import-free so it is unit-tested. No plan names, prices or caps.
//
//  - "active"   : Online payments is on for the owner AND the invoice still has a balance, so the
//                 link is also how the client pays by card.
//  - "inactive" : Online payments is off (or not set up); keep the plain wording and point at Settings.
//  - null       : not an invoice with a balance (an estimate, or nothing owing): the plain wording only.
export type PayLinkState = "active" | "inactive" | null;

export const COPY_LINK_LABEL = "Copy link";
export const COPY_PAYMENT_LINK_LABEL = "Copy payment link";
export const PAY_LINK_LINE = "Your client can view this invoice and pay by card from this link.";
export const PAY_LINK_COPIED_TOAST = "Link copied. Your client can pay online with it.";
export const ENABLE_ONLINE_PAYMENTS_HINT = "Turn on online payments so clients can pay from this link.";
export const ONLINE_PAYMENTS_SETTINGS_HREF = "/dashboard/settings#online-payments";

// Mirrors the server's rule for offering "Pay now": a balance over $1 (see onlinePayableAmount).
const MIN_BALANCE = 1;

export function payLinkState(input: {
  type: string;
  onlinePaymentsActive: boolean;
  total: number;
  paid: number;
}): PayLinkState {
  if (input.type !== "invoice") return null;
  if (Math.round((input.total - input.paid) * 100) / 100 <= MIN_BALANCE) return null;
  return input.onlinePaymentsActive ? "active" : "inactive";
}

export function copyLinkLabel(state: PayLinkState): string {
  return state === "active" ? COPY_PAYMENT_LINK_LABEL : COPY_LINK_LABEL;
}

export function copyLinkToast(type: string, state: PayLinkState): string {
  if (type === "estimate") return "Signature link copied to clipboard";
  return state === "active" ? PAY_LINK_COPIED_TOAST : "Invoice link copied to clipboard";
}
