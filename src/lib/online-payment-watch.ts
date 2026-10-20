// When to keep checking for a payment that arrives by webhook after the page was drawn.
// Pure and import-free so it is unit-tested; the two small client hooks/components that use it
// only add timers and router.refresh().

// ---- the client's invoice page, after they return from Stripe (?paid=1)
export const PUBLIC_POLL_MS = 2000;
export const PUBLIC_POLL_MAX_MS = 30000;

export type ConfirmPhase = "none" | "received" | "confirming" | "processing";

/**
 * received   : the payment is recorded (invoice paid)
 * confirming : came back from Stripe, not recorded yet, still inside the 30 s window: keep polling
 * processing : window over and still not recorded: stop polling, tell them a receipt will follow
 * none       : not a return from Stripe
 */
export function confirmPhase(input: { justPaid: boolean; settled: boolean; elapsedMs: number }): ConfirmPhase {
  if (!input.justPaid) return "none";
  if (input.settled) return "received";
  return input.elapsedMs < PUBLIC_POLL_MAX_MS ? "confirming" : "processing";
}

/** "Pay now" is never offered while a payment the client just made is not recorded yet. */
export function showPayNow(input: { payable: boolean; justPaid: boolean; settled: boolean }): boolean {
  return input.payable && !(input.justPaid && !input.settled);
}

// ---- the owner's invoice page and list
export const OWNER_POLL_MS = 5000;
export const OWNER_WATCH_WINDOW_MS = 30 * 60 * 1000;

/**
 * Poll only while an online Checkout Session was opened in the last 30 minutes and a balance is
 * still owing. `online_session_opened_at` is set when the first session is created, so an invoice
 * whose session is older than that stops being polled (focus still refreshes it).
 */
export function shouldWatchOnlinePayment(
  doc: {
    type: string;
    status: string;
    online_session_opened_at: string | null | undefined;
    total_amount: number;
    payments?: { amount: number }[] | null;
  },
  nowMs: number,
): boolean {
  if (doc.type !== "invoice" || !doc.online_session_opened_at) return false;
  if (doc.status === "paid" || doc.status === "draft") return false;
  const opened = Date.parse(doc.online_session_opened_at);
  if (!Number.isFinite(opened) || nowMs - opened > OWNER_WATCH_WINDOW_MS) return false;
  const paid = (doc.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  return Math.round((doc.total_amount - paid) * 100) / 100 > 0;
}

/** The time-free half of the rule (no clock read, so it can run while rendering): could this invoice still need watching? */
export function mayWatchOnlinePayment(doc: Parameters<typeof shouldWatchOnlinePayment>[0]): boolean {
  const opened = doc.online_session_opened_at ? Date.parse(doc.online_session_opened_at) : NaN;
  return Number.isFinite(opened) && shouldWatchOnlinePayment(doc, opened);
}
