// Pure rules for online invoice payments (Stripe Connect). Import-free of the
// app's alias paths so they can be unit-tested with `node --test`.

export type ConnectStatus = "not_connected" | "incomplete" | "restricted" | "active" | "disconnected";

export interface AccountLike {
  details_submitted?: boolean | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  country?: string | null;
  default_currency?: string | null;
  /** Capability statuses as Stripe reports them ("active" | "inactive" | "pending" | ...). */
  capabilities?: { card_payments?: string | null; transfers?: string | null } | null;
}

// Canada and CAD only. An account that finished onboarding but can not take
// charges (or is outside Canada / not settling in CAD) is "restricted" - the
// owner is sent back to Stripe, and "Pay now" stays hidden.
//
// "Active" needs `charges_enabled` - that is what Pay now relies on. When Stripe also
// reports the card_payments capability, it must be "active" too: a capability that is
// still pending/inactive (for example while `transfers` is being verified - Stripe
// disables both if either is inactive) never counts as active, whatever else is true.
// The `transfers` capability itself is only requested because Stripe requires it for
// card_payments; we never move money with it, so its status is not checked separately.
export function connectStatusFromAccount(account: AccountLike): ConnectStatus {
  if (!account.details_submitted) return "incomplete";
  if (account.country && account.country.toUpperCase() !== "CA") return "restricted";
  if (account.default_currency && account.default_currency.toLowerCase() !== "cad") return "restricted";
  const cardPayments = account.capabilities?.card_payments;
  if (cardPayments && cardPayments !== "active") return "restricted";
  return account.charges_enabled ? "active" : "restricted";
}

export function connectColumns(account: AccountLike, now: Date) {
  const status = connectStatusFromAccount(account);
  return {
    stripe_connect_status: status,
    stripe_connect_charges_enabled: status === "active",
    stripe_connect_payouts_enabled: status === "active" && Boolean(account.payouts_enabled),
    stripe_connect_checked_at: now.toISOString(),
  };
}

// Prefilled so a contractor with no website still has a business description ready - Stripe
// asks for either a URL or a product description during onboarding.
export const CONNECT_PRODUCT_DESCRIPTION = "Contracting and trade services, invoiced through TaxSnap";

// The parameters for creating a contractor's connected account: the full-dashboard,
// Stripe-covers-losses configuration (Stripe's documented Standard mapping), Canada, and
// BOTH card_payments and transfers (Stripe rejects card_payments alone). Plain data, so
// it is unit-tested directly; stripe-connect.ts hands it to stripe.accounts.create.
export function connectedAccountParams(input: {
  userId: string;
  email: string | null;
  businessName: string | null;
}) {
  return {
    country: "CA",
    ...(input.email ? { email: input.email } : {}),
    business_profile: {
      ...(input.businessName ? { name: input.businessName } : {}),
      product_description: CONNECT_PRODUCT_DESCRIPTION,
    },
    controller: {
      stripe_dashboard: { type: "full" as const },
      requirement_collection: "stripe" as const,
      fees: { payer: "account" as const },
      losses: { payments: "stripe" as const },
    },
    capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
    metadata: { taxsnap_user_id: input.userId },
  };
}

export const DISCONNECTED_COLUMNS = {
  stripe_connect_status: "disconnected" as const,
  stripe_connect_charges_enabled: false,
  stripe_connect_payouts_enabled: false,
};

export const CONNECT_STATUS_LABEL: Record<ConnectStatus, string> = {
  not_connected: "Not connected",
  incomplete: "Setup not finished",
  restricted: "Action needed",
  active: "Active",
  disconnected: "Disconnected",
};

// Full balance only (no deposits or partials yet). The balance must be OVER one
// dollar: Stripe's CA$0.50 minimum is far below what is worth charging with a
// $0.30 fixed fee. Returns the amount to charge in dollars, or null when the
// invoice can not be paid online right now. Every reason collapses to null on
// purpose - the public route gives the same answer for all of them.
export const MIN_ONLINE_BALANCE = 1;

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function onlinePayableAmount(input: {
  type: string;
  status: string;
  total: number;
  paid: number;
  connectStatus: string | null | undefined;
  chargesEnabled: boolean | null | undefined;
  hasAccount: boolean;
  /** documents.payment_disputed: a dispute on this invoice is open. */
  disputed: boolean;
}): number | null {
  if (input.type !== "invoice") return null;
  if (input.disputed) return null;
  if (input.status !== "sent" && input.status !== "partial") return null;
  if (!input.hasAccount || input.connectStatus !== "active" || !input.chargesEnabled) return null;
  const balance = round2(input.total - input.paid);
  return balance > MIN_ONLINE_BALANCE ? balance : null;
}

export function toCents(dollars: number): number {
  return Math.round(round2(dollars) * 100);
}

// Same invoice + same amount + same moment => the same Checkout Session, so a
// double-click does not open two. The 10-minute bucket keeps a replay inside the
// session's 30-minute life (Stripe returns the SAME session for a reused key).
export const CHECKOUT_KEY_BUCKET_MS = 10 * 60 * 1000;
export const CHECKOUT_EXPIRES_SECONDS = 30 * 60;

export function checkoutIdempotencyKey(documentId: string, cents: number, nowMs: number): string {
  return `invoice-${documentId}-${cents}-${Math.floor(nowMs / CHECKOUT_KEY_BUCKET_MS)}`;
}

// The part of the amount that is HST, for the one-line description on Checkout.
export function hstPortion(amount: number, total: number, hst: number): number {
  return total > 0 ? round2((amount * hst) / total) : 0;
}

export const RATE_LIMIT = { windowMinutes: 10, perToken: 5, perIp: 20 } as const;

export function isRateLimited(counts: { token: number; ip: number }): boolean {
  return counts.token > RATE_LIMIT.perToken || counts.ip > RATE_LIMIT.perIp;
}

// The one answer for an unknown token, an unsent/paid invoice, a missing or
// restricted account, or a balance too small - nothing about the reason leaks.
export const NOT_PAYABLE_MESSAGE = "This invoice can't be paid online.";
