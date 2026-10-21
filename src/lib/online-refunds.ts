import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { round2, statusFromPaid } from "./payments.ts";
import { torontoToday } from "./work-date.ts";
import type { FeeExpenseInput, FeeExpenseResult } from "./stripe-fee-expense.ts";

type Admin = SupabaseClient<Database>;

// Online payments, phase 4: refunds, disputes and the double-payment guard.
//
// Refunds and disputes are handled by the contractor in their own Stripe Dashboard; this file
// only MIRRORS them into `payments` as NEGATIVE rows, so invoice status, "Paid to date", revenue
// and the HST figures (all sums of signed payments, pro-rated per payment and counted in the
// period of the row's own paid_date) follow with no other change. A refund in a later period
// therefore reduces that later period and never rewrites the earlier one.
//
//   source 'stripe_refund'   one row per Stripe refund (unique stripe_refund_id), dated on the refund
//   source 'stripe_dispute'  one row for a LOST dispute (unique stripe_dispute_id), dated on the loss
//
// A dispute that is merely OPEN reverses nothing: it flags the invoice (documents.payment_disputed)
// and emails the owner. Won = flag cleared, books untouched. The dispute FEE is recorded once as a
// no-tax expense (stripe-fee-expense.ts) when it is first known; a refund creates no expense at all.
//
// Everything is re-read from Stripe by id (never trusted from the payload), so out-of-order and
// replayed events converge on the same ledger. When the row a refund or dispute belongs to is not
// there yet, `RetryLater` makes the webhook answer 500 so Stripe delivers the event again.

// Tells a refund WE issued for a double payment apart from a normal one. The refund is created with
// this metadata flag AND its id is stored on stripe_overpayments, so either identifies it; the excess
// was never recorded as a payment, so mirroring that refund would subtract money that was never added.
export const EXCESS_REFUND_FLAG = "taxsnap_excess_refund";

export class RetryLater extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryLater";
  }
}

// ------------------------------------------------------------------ Stripe object shapes (just what we read)

export interface ChargeLike {
  id: string;
  currency?: string | null;
  payment_intent?: string | null;
  /** Copied from the PaymentIntent at creation: carries our document_id. */
  metadata?: Record<string, string> | null;
}

export interface RefundLike {
  id: string;
  amount: number; // cents
  status?: string | null;
  created: number; // unix seconds
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

export interface DisputeLike {
  id: string;
  charge?: string | null;
  payment_intent?: string | null;
  amount: number; // cents
  currency?: string | null;
  status: string;
  /** Unix seconds when the dispute was received: the date of its fee expense. */
  created?: number | null;
  /** Stripe's dispute fee shows up here (summed into stripe_disputes.fee, then recorded as an expense). */
  balance_transactions?: { fee?: number | null }[] | null;
}

export type OwnerNotice =
  | { kind: "dispute_opened"; userId: string; documentNumber: number; amount: number; disputeId: string; livemode: boolean }
  | { kind: "excess_refunded"; userId: string; documentNumber: number; amount: number; paymentIntentId: string; livemode: boolean }
  | { kind: "excess_refund_failed"; userId: string; documentNumber: number; amount: number; paymentIntentId: string; livemode: boolean };

export interface RefundDeps {
  now: () => Date;
  retrieveCharge: (chargeId: string, accountId: string) => Promise<ChargeLike>;
  listRefunds: (chargeId: string, accountId: string) => Promise<RefundLike[]>;
}

export interface DisputeDeps {
  now: () => Date;
  retrieveCharge: (chargeId: string, accountId: string) => Promise<ChargeLike>;
  retrieveDispute: (disputeId: string, accountId: string) => Promise<DisputeLike>;
  /** Emails the owner; false when it could not be sent. Never throws. */
  notifyOwner: (notice: OwnerNotice) => Promise<boolean>;
  /** Records the dispute fee as an expense (once; a no-op when the owner's switch is off). Throws on a failure so Stripe retries. */
  recordFeeExpense: (input: FeeExpenseInput) => Promise<FeeExpenseResult>;
}

export interface ExcessDeps {
  /** A refund this app already issued for the payment intent (found by the metadata flag), if any. */
  findExcessRefund: (paymentIntentId: string, accountId: string) => Promise<{ id: string } | null>;
  /** The ONE Stripe write in this feature: refunds the excess on the connected account. */
  refundExcess: (args: {
    paymentIntentId: string;
    accountId: string;
    cents: number;
    idempotencyKey: string;
    documentId: string;
  }) => Promise<{ id: string }>;
  notifyOwner: (notice: OwnerNotice) => Promise<boolean>;
}

// ------------------------------------------------------------------ pure rules

// Stripe's dispute statuses that mean "still being decided". Anything else is closed.
const OPEN_DISPUTE_STATUSES = new Set(["warning_needs_response", "warning_under_review", "needs_response", "under_review"]);

export function isDisputeOpen(status: string): boolean {
  return OPEN_DISPUTE_STATUSES.has(status);
}

export function disputeStripeUrl(disputeId: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}disputes/${encodeURIComponent(disputeId)}`;
}

export function paymentStripeUrl(paymentIntentId: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? "" : "test/"}payments/${encodeURIComponent(paymentIntentId)}`;
}

export function excessRefundKey(paymentIntentId: string): string {
  return `taxsnap-excess-${paymentIntentId}`;
}

// Is this refund the automatic refund of a double payment (and so not a ledger event)?
export function isExcessRefund(refund: RefundLike, overpayment: { refund_id: string | null } | null): boolean {
  return refund.metadata?.[EXCESS_REFUND_FLAG] === "1" || (overpayment?.refund_id != null && overpayment.refund_id === refund.id);
}

// What a reversal may take off a payment: the payment's own amount minus what earlier reversals
// already took. A reversal can never push the payment below zero (e.g. an owner refund made before
// our excess refund, or a lost dispute on a charge that was partly refunded).
export function reversalCapacity(paymentAmount: number, earlierReversals: number[]): number {
  return Math.max(0, round2(paymentAmount + earlierReversals.reduce((s, n) => s + n, 0)));
}

export function planReversal(requested: number, capacity: number): { amount: number; capped: boolean } | null {
  const amount = Math.min(round2(requested), capacity);
  if (amount <= 0) return null;
  return { amount, capped: amount < round2(requested) };
}

// ------------------------------------------------------------------ the ledger a Stripe object points at

interface PaymentRow {
  id: string;
  amount: number;
  source: string;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  stripe_dispute_id: string | null;
}

interface Ledger {
  doc: { id: string; user_id: string; type: string; status: string; total_amount: number; document_number: number };
  paymentIntentId: string;
  original: PaymentRow;
  payments: PaymentRow[];
}

const PAYMENT_COLUMNS = "id, amount, source, stripe_payment_intent_id, stripe_refund_id, stripe_dispute_id";

// Finds the invoice and payment a charge belongs to, checking that the event came from the very
// connected account that owns the invoice. `ignored` = not ours / not for us (200, nothing done);
// RetryLater = it IS ours but the payment is not recorded yet (500, Stripe retries).
async function loadLedger(
  admin: Admin,
  accountId: string,
  charge: ChargeLike,
): Promise<{ ledger: Ledger } | { ignored: string }> {
  if ((charge.currency ?? "").toLowerCase() !== "cad") return { ignored: "not_cad" };
  const paymentIntentId = charge.payment_intent;
  if (!paymentIntentId) return { ignored: "no_payment_intent" };

  const { data: original } = await admin
    .from("payments")
    .select(`document_id, ${PAYMENT_COLUMNS}`)
    .eq("stripe_payment_intent_id", paymentIntentId)
    .eq("source", "stripe")
    .maybeSingle();

  if (!original) {
    // A paid session that over-credited an invoice and was refunded in full was never recorded.
    const { data: over } = await admin
      .from("stripe_overpayments")
      .select("payment_intent_id")
      .eq("payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (over) return { ignored: "payment_never_recorded" };
    // Ours (the charge carries our document id) but checkout.session.completed has not been
    // processed yet: do not drop the event, ask Stripe to deliver it again.
    if (charge.metadata?.document_id) throw new RetryLater(`payment for ${paymentIntentId} is not recorded yet`);
    return { ignored: "not_a_taxsnap_payment" };
  }

  const documentId = (original as unknown as { document_id: string }).document_id;
  const { data: doc } = await admin
    .from("documents")
    .select("id, user_id, type, status, total_amount, document_number")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc || doc.type !== "invoice") return { ignored: "unknown_invoice" };

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", doc.user_id)
    .maybeSingle();
  if (!profile || profile.stripe_connect_account_id !== accountId) return { ignored: "account_mismatch" };

  const { data: payments } = await admin.from("payments").select(PAYMENT_COLUMNS).eq("document_id", doc.id);
  return { ledger: { doc, paymentIntentId, original, payments: (payments ?? []) as PaymentRow[] } };
}

function signedTotal(payments: { amount: number }[]): number {
  return round2(payments.reduce((sum, p) => sum + p.amount, 0));
}

// Status follows the signed payment total, exactly as for a manual payment (a fully refunded
// invoice goes back to sent/unpaid, a partly refunded one to partial). Only written when it changes.
async function syncStatus(admin: Admin, ledger: Ledger, total: number, now: Date): Promise<void> {
  const next = statusFromPaid(total, ledger.doc.total_amount);
  if (next === ledger.doc.status) return;
  const { error } = await admin
    .from("documents")
    .update({ status: next, updated_at: now.toISOString() })
    .eq("id", ledger.doc.id);
  if (error) throw new Error(error.message);
}

// Reversals already booked against this payment intent (refund and dispute rows), as negatives.
function earlierReversals(ledger: Ledger): number[] {
  return ledger.payments
    .filter(
      (p) =>
        (p.source === "stripe_refund" || p.source === "stripe_dispute") &&
        p.stripe_payment_intent_id === ledger.paymentIntentId,
    )
    .map((p) => p.amount);
}

// ------------------------------------------------------------------ charge.refunded

export type RefundResult =
  | { status: "ignored"; reason: string }
  | { status: "processed"; recorded: number; skippedExcess: number; capped: number };

export async function processChargeRefunded(
  admin: Admin,
  eventAccount: string | null,
  chargeObject: { id?: string; object?: string },
  deps: RefundDeps,
): Promise<RefundResult> {
  if (!eventAccount) return { status: "ignored", reason: "no_connected_account" };
  if ((chargeObject.object && chargeObject.object !== "charge") || typeof chargeObject.id !== "string") {
    return { status: "ignored", reason: "not_a_charge" };
  }

  // Re-read the charge and ALL of its refunds: several partial refunds on one payment each
  // become their own row, and an event that arrives late or twice just finds them already there.
  const charge = await deps.retrieveCharge(chargeObject.id, eventAccount);
  const refunds = (await deps.listRefunds(chargeObject.id, eventAccount)).slice().sort((a, b) => a.created - b.created);

  const found = await loadLedger(admin, eventAccount, charge);
  if ("ignored" in found) return { status: "ignored", reason: found.ignored };
  const { ledger } = found;

  const { data: overpayment } = await admin
    .from("stripe_overpayments")
    .select("refund_id")
    .eq("payment_intent_id", ledger.paymentIntentId)
    .maybeSingle();

  const known = new Set(ledger.payments.map((p) => p.stripe_refund_id).filter((id): id is string => Boolean(id)));
  let capacity = reversalCapacity(ledger.original.amount, earlierReversals(ledger));
  let total = signedTotal(ledger.payments);
  let recorded = 0;
  let skippedExcess = 0;
  let capped = 0;
  let pending = false;

  for (const refund of refunds) {
    if (refund.status === "pending" || refund.status === "requires_action") {
      pending = true;
      continue;
    }
    if (refund.status !== "succeeded") continue; // failed / canceled: no money moved
    if (known.has(refund.id)) continue; // already mirrored
    if (isExcessRefund(refund, overpayment)) {
      skippedExcess += 1;
      continue;
    }
    const plan = planReversal(refund.amount / 100, capacity);
    if (!plan) continue;
    const { error } = await admin.from("payments").insert({
      document_id: ledger.doc.id,
      amount: -plan.amount,
      paid_date: torontoToday(new Date(refund.created * 1000)),
      method: "Refund (card)",
      source: "stripe_refund",
      stripe_account_id: eventAccount,
      stripe_payment_intent_id: ledger.paymentIntentId,
      stripe_charge_id: charge.id,
      stripe_refund_id: refund.id,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
    if (error) continue; // a concurrent replay won the race
    known.add(refund.id);
    capacity = round2(capacity - plan.amount);
    total = round2(total - plan.amount);
    recorded = round2(recorded + plan.amount);
    if (plan.capped) capped += 1;
  }

  await syncStatus(admin, ledger, total, deps.now());
  if (pending) throw new RetryLater("a refund is still pending");
  return { status: "processed", recorded, skippedExcess, capped };
}

// ------------------------------------------------------------------ disputes

export type DisputeResult =
  | { status: "ignored"; reason: string }
  | { status: "synced"; disputeStatus: string; reversed: number; notified: boolean };

export interface DisputeSyncOptions {
  /** Unix seconds of the Stripe event: a lost dispute is dated on it, so a late retry keeps its date. */
  eventCreated?: number;
  livemode: boolean;
  /** charge.dispute.created: email the owner while the dispute is open (once). */
  notifyOnOpen: boolean;
}

// One routine for BOTH dispute events. It re-reads the dispute and applies its CURRENT state, so
// "closed" arriving before "created" (or either arriving twice) ends in the same place.
export async function syncDispute(
  admin: Admin,
  eventAccount: string | null,
  disputeObject: { id?: string; object?: string },
  options: DisputeSyncOptions,
  deps: DisputeDeps,
): Promise<DisputeResult> {
  if (!eventAccount) return { status: "ignored", reason: "no_connected_account" };
  if ((disputeObject.object && disputeObject.object !== "dispute") || typeof disputeObject.id !== "string") {
    return { status: "ignored", reason: "not_a_dispute" };
  }

  const dispute = await deps.retrieveDispute(disputeObject.id, eventAccount);
  if (!dispute.charge) return { status: "ignored", reason: "no_charge" };
  const charge = await deps.retrieveCharge(dispute.charge, eventAccount);
  const found = await loadLedger(admin, eventAccount, charge);
  if ("ignored" in found) return { status: "ignored", reason: found.ignored };
  const { ledger } = found;

  const amount = round2(dispute.amount / 100);
  const fees = (dispute.balance_transactions ?? []).reduce((sum, bt) => sum + (bt.fee ?? 0), 0);
  const fee = fees > 0 ? round2(fees / 100) : null;
  const open = isDisputeOpen(dispute.status);
  const now = deps.now();

  const { data: existing } = await admin
    .from("stripe_disputes")
    .select("id, owner_notified_at")
    .eq("id", dispute.id)
    .maybeSingle();
  const fields = {
    status: dispute.status,
    fee,
    closed_at: open ? null : now.toISOString(),
  };
  if (existing) {
    const { error } = await admin.from("stripe_disputes").update(fields).eq("id", dispute.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin.from("stripe_disputes").insert({
      id: dispute.id,
      account_id: eventAccount,
      document_id: ledger.doc.id,
      payment_intent_id: ledger.paymentIntentId,
      charge_id: charge.id,
      amount,
      ...fields,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
  }

  // A LOST dispute takes the money back: one negative row, dated on the loss.
  let reversed = 0;
  let total = signedTotal(ledger.payments);
  if (dispute.status === "lost") {
    const already = ledger.payments.some((p) => p.stripe_dispute_id === dispute.id);
    if (!already) {
      const capacity = reversalCapacity(ledger.original.amount, earlierReversals(ledger));
      const plan = planReversal(amount, capacity);
      if (plan) {
        const when = options.eventCreated ? new Date(options.eventCreated * 1000) : now;
        const { error } = await admin.from("payments").insert({
          document_id: ledger.doc.id,
          amount: -plan.amount,
          paid_date: torontoToday(when),
          method: "Dispute lost (card)",
          source: "stripe_dispute",
          stripe_account_id: eventAccount,
          stripe_payment_intent_id: ledger.paymentIntentId,
          stripe_charge_id: charge.id,
          stripe_dispute_id: dispute.id,
          stripe_fee: fee,
        });
        if (error && error.code !== "23505") throw new Error(error.message);
        if (!error) {
          reversed = plan.amount;
          total = round2(total - plan.amount);
        }
      }
    }
  }
  await syncStatus(admin, ledger, total, now);

  // The banner is on while ANY dispute of this invoice is open.
  const { data: disputes } = await admin.from("stripe_disputes").select("status").eq("document_id", ledger.doc.id);
  const anyOpen = (disputes ?? []).some((d) => isDisputeOpen(d.status));
  const { error: flagError } = await admin
    .from("documents")
    .update({ payment_disputed: anyOpen })
    .eq("id", ledger.doc.id);
  if (flagError) throw new Error(flagError.message);

  // Told once, only while it is still open. A failed email never fails the event (the books and
  // the banner are right); it is retried only if the event itself is retried.
  let notified = false;
  if (options.notifyOnOpen && open && !existing?.owner_notified_at) {
    notified = await deps
      .notifyOwner({
        kind: "dispute_opened",
        userId: ledger.doc.user_id,
        documentNumber: ledger.doc.document_number,
        amount,
        disputeId: dispute.id,
        livemode: options.livemode,
      })
      .catch(() => false);
    if (notified) {
      await admin.from("stripe_disputes").update({ owner_notified_at: now.toISOString() }).eq("id", dispute.id);
    } else {
      console.warn(`[dispute] owner email failed document=${ledger.doc.id}`);
    }
  }

  // The dispute fee, from the fee stored on the dispute row above (Stripe's own figure, never a constant).
  // Last, so a failure throws after everything else is right and the retry only has this left to do.
  if (fee) {
    const received = dispute.created ? new Date(dispute.created * 1000) : options.eventCreated ? new Date(options.eventCreated * 1000) : now;
    await deps.recordFeeExpense({
      userId: ledger.doc.user_id,
      source: { kind: "dispute", id: dispute.id },
      fee,
      date: torontoToday(received),
      documentNumber: ledger.doc.document_number,
    });
  }

  return { status: "synced", disputeStatus: dispute.status, reversed, notified };
}

// ------------------------------------------------------------------ the double-payment guard

export interface ExcessInput {
  documentId: string;
  userId: string;
  documentNumber: number;
  accountId: string;
  paymentIntentId: string;
  /** Everything the payer paid. */
  amountPaid: number;
  /** What became a payment row (0 when the invoice was already covered). */
  amountRecorded: number;
  livemode: boolean;
}

// Anything paid beyond what was recorded is refunded to the payer on the connected account,
// automatically, with an idempotency key (and a look for an existing flagged refund first, since
// Stripe forgets keys after 24 h). The excess was never recorded, so its refund must not become a
// negative row: processChargeRefunded recognises it by `taxsnap_excess_refund` / stripe_overpayments.
// A failure is thrown after the owner is told, so the webhook answers 500 and Stripe retries.
export async function settleExcess(admin: Admin, input: ExcessInput, deps: ExcessDeps): Promise<{ excess: number; refunded: boolean }> {
  const excess = round2(input.amountPaid - input.amountRecorded);
  if (excess <= 0) return { excess: 0, refunded: false };

  type Row = { refund_status: string; owner_notified_at: string | null; failure_notified_at: string | null };
  const read = async (): Promise<Row | null> => {
    const { data } = await admin
      .from("stripe_overpayments")
      .select("refund_status, owner_notified_at, failure_notified_at")
      .eq("payment_intent_id", input.paymentIntentId)
      .maybeSingle();
    return (data as Row | null) ?? null;
  };

  let row = await read();
  if (!row) {
    const { error } = await admin.from("stripe_overpayments").insert({
      payment_intent_id: input.paymentIntentId,
      account_id: input.accountId,
      document_id: input.documentId,
      amount_paid: input.amountPaid,
      amount_recorded: input.amountRecorded,
      amount_excess: excess,
    });
    if (error && error.code !== "23505") throw new Error(error.message);
    row = await read();
  }
  if (row?.refund_status === "refunded") return { excess, refunded: true };

  const stamp = () => new Date().toISOString();
  try {
    const refund =
      (await deps.findExcessRefund(input.paymentIntentId, input.accountId)) ??
      (await deps.refundExcess({
        paymentIntentId: input.paymentIntentId,
        accountId: input.accountId,
        cents: Math.round(excess * 100),
        idempotencyKey: excessRefundKey(input.paymentIntentId),
        documentId: input.documentId,
      }));
    await admin
      .from("stripe_overpayments")
      .update({ refund_status: "refunded", refund_id: refund.id })
      .eq("payment_intent_id", input.paymentIntentId);
    if (!row?.owner_notified_at) {
      const sent = await deps
        .notifyOwner({
          kind: "excess_refunded",
          userId: input.userId,
          documentNumber: input.documentNumber,
          amount: excess,
          paymentIntentId: input.paymentIntentId,
          livemode: input.livemode,
        })
        .catch(() => false);
      if (sent) await admin.from("stripe_overpayments").update({ owner_notified_at: stamp() }).eq("payment_intent_id", input.paymentIntentId);
    }
    return { excess, refunded: true };
  } catch (err) {
    await admin.from("stripe_overpayments").update({ refund_status: "failed" }).eq("payment_intent_id", input.paymentIntentId);
    if (!row?.failure_notified_at) {
      const sent = await deps
        .notifyOwner({
          kind: "excess_refund_failed",
          userId: input.userId,
          documentNumber: input.documentNumber,
          amount: excess,
          paymentIntentId: input.paymentIntentId,
          livemode: input.livemode,
        })
        .catch(() => false);
      if (sent) await admin.from("stripe_overpayments").update({ failure_notified_at: stamp() }).eq("payment_intent_id", input.paymentIntentId);
    }
    throw err;
  }
}
