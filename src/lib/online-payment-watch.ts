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

// WHY THIS EXISTS: the owner often has the invoice open BEFORE the client taps "Pay now", so the page was drawn with
// online_session_opened_at = null. The old hook decided whether to watch only from those props, so it never started an
// interval or a focus listener, and nothing re-read the page when the payment landed (no GET /dashboard/invoices/<id>
// in the dev log until a manual reload). Now any sent / partly paid invoice with a balance is watched: quickly (every
// 5 s) while a session is fresh, slowly (every 15 s) otherwise, and always once when the owner comes back to the tab.
export const OWNER_IDLE_POLL_MS = 15000;
export const OWNER_IDLE_WINDOW_MS = 30 * 60 * 1000;

type WatchedDoc = Parameters<typeof shouldWatchOnlinePayment>[0];

/** Time-free: an issued invoice that still owes a balance could receive a payment at any moment. */
export function awaitsPayment(doc: WatchedDoc): boolean {
  if (doc.type !== "invoice" || (doc.status !== "sent" && doc.status !== "partial")) return false;
  const paid = (doc.payments ?? []).reduce((sum, p) => sum + p.amount, 0);
  return Math.round((doc.total_amount - paid) * 100) / 100 > 0;
}

/**
 * Should the owner's page re-read the server now? (checked on a 5 s timer while the tab is visible)
 *  - fresh online session (shouldWatchOnlinePayment): every OWNER_POLL_MS
 *  - otherwise an invoice awaiting payment: every OWNER_IDLE_POLL_MS, for 30 minutes after the page was last
 *    "armed" (opened or the owner came back to the tab), so an abandoned tab does not poll forever
 */
export function shouldRefreshOwnerView(
  docs: WatchedDoc[],
  t: { now: number; armedAt: number; lastRefreshAt: number },
): boolean {
  const since = t.now - t.lastRefreshAt;
  if (docs.some((d) => shouldWatchOnlinePayment(d, t.now))) return since >= OWNER_POLL_MS;
  if (docs.some(awaitsPayment)) return t.now - t.armedAt <= OWNER_IDLE_WINDOW_MS && since >= OWNER_IDLE_POLL_MS;
  return false;
}

/** The time-free half of the rule (no clock read, so it can run while rendering): could this invoice still need watching? */
export function mayWatchOnlinePayment(doc: Parameters<typeof shouldWatchOnlinePayment>[0]): boolean {
  const opened = doc.online_session_opened_at ? Date.parse(doc.online_session_opened_at) : NaN;
  return Number.isFinite(opened) && shouldWatchOnlinePayment(doc, opened);
}
