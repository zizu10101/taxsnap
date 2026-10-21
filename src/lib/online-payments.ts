import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";
import { connectColumns, DISCONNECTED_COLUMNS, isRateLimited, RATE_LIMIT, type AccountLike } from "./connect-status.ts";
import { round2, statusFromPaid } from "./payments.ts";
import { torontoToday } from "./work-date.ts";
import {
  processChargeRefunded,
  settleExcess,
  syncDispute,
  type DisputeDeps,
  type ExcessDeps,
  type RefundDeps,
} from "./online-refunds.ts";
import type { FeeExpenseInput, FeeExpenseResult } from "./stripe-fee-expense.ts";
import { logStripeError } from "./stripe-error.ts";
import { RetryLater } from "./online-refunds.ts";

type Admin = SupabaseClient<Database>;

// ------------------------------------------------------------------ webhook plumbing

// Every Stripe event id is claimed before it is handled. "duplicate" = already
// fully processed (answer 200 and do nothing); "retry" = seen but never finished
// (process it again); "new" = first time.
export async function claimEvent(
  admin: Admin,
  event: { id: string; type: string; account?: string | null },
): Promise<"new" | "duplicate" | "retry"> {
  const { error } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, account_id: event.account ?? null });
  if (!error) return "new";
  if (error.code === "23505") {
    const { data } = await admin.from("stripe_events").select("processed_at").eq("id", event.id).maybeSingle();
    return data?.processed_at ? "duplicate" : "retry";
  }
  throw new Error(error.message);
}

export async function completeEvent(admin: Admin, id: string, note?: string | null): Promise<void> {
  await admin
    .from("stripe_events")
    .update({ processed_at: new Date().toISOString(), ...(note ? { note } : {}) })
    .eq("id", id);
}

// ------------------------------------------------------------------ account status

// Writes the account's current status onto the profile that owns it. Returns
// false for an account we have no profile for (ignored, never an error).
export async function syncConnectAccount(
  admin: Admin,
  account: AccountLike & { id: string },
  now: Date,
): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .update(connectColumns(account, now))
    .eq("stripe_connect_account_id", account.id)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function markDisconnected(admin: Admin, accountId: string, now: Date): Promise<boolean> {
  const { data, error } = await admin
    .from("profiles")
    .update({ ...DISCONNECTED_COLUMNS, stripe_connect_checked_at: now.toISOString() })
    .eq("stripe_connect_account_id", accountId)
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

// ------------------------------------------------------------------ recording a payment

export type StripePaymentPlan =
  | { action: "duplicate" }
  | { action: "skip"; overpaid: number }
  | { action: "record"; amount: number; overpaid: number };

// How much of a paid Checkout Session becomes a payment row. Normally all of it.
// A second session paid for an invoice that is already covered (the double-pay
// case) is capped at what is still owed and the rest is reported as `overpaid`;
// processCheckoutCompleted then refunds that excess automatically (settleExcess).
export function planStripePayment(input: {
  total: number;
  existingPaid: number;
  amountPaid: number;
  alreadyRecorded: boolean;
}): StripePaymentPlan {
  if (input.alreadyRecorded) return { action: "duplicate" };
  const remaining = round2(input.total - input.existingPaid);
  if (remaining <= 0) return { action: "skip", overpaid: round2(input.amountPaid) };
  const amount = Math.min(round2(input.amountPaid), remaining);
  return { action: "record", amount, overpaid: round2(input.amountPaid - amount) };
}

export interface CheckoutSessionLike {
  object?: string;
  id?: string;
  mode?: string | null;
  payment_status?: string | null;
  currency?: string | null;
  amount_total?: number | null;
  payment_intent?: string | { id?: string } | null;
  metadata?: Record<string, string> | null;
  /** What the payer typed into Checkout. */
  customer_details?: { email?: string | null } | null;
}

function looksLikeEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Who gets the TaxSnap receipt: the client's email on file; if there is none, the email
// the payer entered in Checkout. The Checkout email is used for this one receipt only -
// it is never saved onto the client. null = nobody to send it to.
export function receiptRecipient(
  clientEmail: string | null | undefined,
  checkoutEmail: string | null | undefined,
): { to: string; source: "client" | "checkout" } | null {
  const onFile = clientEmail?.trim();
  if (onFile) return { to: onFile, source: "client" };
  const entered = checkoutEmail?.trim();
  if (entered && looksLikeEmail(entered)) return { to: entered, source: "checkout" };
  return null;
}

// Only a fully paid, one-off CAD payment session with our document id counts.
export function readPaidSession(
  session: CheckoutSessionLike,
): { documentId: string; sessionId: string; paymentIntentId: string; amount: number } | null {
  if (session.object && session.object !== "checkout.session") return null;
  if (session.mode !== "payment" || session.payment_status !== "paid") return null;
  if ((session.currency ?? "").toLowerCase() !== "cad") return null;
  const cents = session.amount_total;
  if (typeof cents !== "number" || !Number.isInteger(cents) || cents <= 0) return null;
  const documentId = session.metadata?.document_id;
  if (!documentId || typeof session.id !== "string") return null;
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (!pi) return null;
  return { documentId, sessionId: session.id, paymentIntentId: pi, amount: round2(cents / 100) };
}

export interface ReceiptArgs {
  to: string;
  businessName: string | null;
  clientName: string;
  documentNumber: number;
  amountPaid: number;
  balanceRemaining: number;
  viewToken: string | null;
  brandFooter: boolean;
}

export interface StripeFee {
  fee: number;
  net: number;
  chargeId: string | null;
}

// WHY THIS EXISTS: Stripe creates a charge's balance transaction (the only place the fee lives) about 3 seconds
// AFTER the charge succeeds - measured in the sandbox: null right after confirmation, present ~3 s later, and
// charge.updated fires when it appears. checkout.session.completed arrives inside that window, so the first
// read finds latest_charge.balance_transaction null. That is not an error, so nothing was logged and the
// payment row was saved with no fee (and so no fee expense). Two layers now close the gap:
//   1. a short bounded retry right after the payment is saved (readFeeWithRetry), so the fee expense is created
//      in the same delivery in the normal case;
//   2. charge.updated (processChargeUpdated below) and any replay of the checkout event fill in a fee that is
//      still missing - both idempotent with fee_expense_outcome (the expense is created once, ever).
export const FEE_READ_ATTEMPTS = 6;
export const FEE_READ_DELAY_MS = 1000;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function readFeeWithRetry(
  deps: Pick<CheckoutDeps, "fetchFee" | "sleep">,
  paymentIntentId: string,
  accountId: string,
  where: string,
): Promise<StripeFee | null> {
  const sleep = deps.sleep ?? realSleep;
  for (let attempt = 1; attempt <= FEE_READ_ATTEMPTS; attempt++) {
    try {
      const fee = await deps.fetchFee(paymentIntentId, accountId);
      if (fee) return fee;
    } catch (err) {
      // A real Stripe error: say so (never swallow it), then try again.
      logStripeError(`where=${where} pi=${paymentIntentId} attempt=${attempt}/${FEE_READ_ATTEMPTS}`, err);
    }
    if (attempt < FEE_READ_ATTEMPTS) await sleep(FEE_READ_DELAY_MS);
  }
  console.warn(`[fee] not available yet where=${where} pi=${paymentIntentId}: charge.updated or a replay will fill it in`);
  return null;
}

// Stores a fee on the payment row and records its expense (once).
async function storeFeeAndRecord(
  admin: Admin,
  deps: Pick<CheckoutDeps, "recordFeeExpense">,
  payment: { id: string; date: string },
  doc: { user_id: string; document_number: number },
  fee: StripeFee,
): Promise<void> {
  const { error } = await admin
    .from("payments")
    .update({ stripe_fee: fee.fee, stripe_net: fee.net, stripe_charge_id: fee.chargeId })
    .eq("id", payment.id);
  if (error) throw new Error(error.message);
  await deps.recordFeeExpense({
    userId: doc.user_id,
    source: { kind: "payment", id: payment.id },
    fee: fee.fee,
    date: payment.date,
    documentNumber: doc.document_number,
  });
}

export interface CheckoutDeps extends ExcessDeps {
  now: () => Date;
  /** Whether the Stripe event came from live mode (only used for the Dashboard links in owner emails). */
  livemode?: boolean;
  /**
   * Stripe's processing fee for the payment; null when the charge has no balance transaction YET (Stripe attaches it
   * a few seconds after the charge succeeds - see readFeeWithRetry). Throws on a Stripe error.
   */
  fetchFee: (paymentIntentId: string, accountId: string) => Promise<StripeFee | null>;
  /** Waits between fee reads. Defaults to a real timer; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  sendReceipt: (args: ReceiptArgs) => Promise<boolean>;
  /** Records Stripe's fee as an expense (once; a no-op when the owner's switch is off). Throws on a failure so Stripe retries. */
  recordFeeExpense: (input: FeeExpenseInput) => Promise<FeeExpenseResult>;
}

export type CheckoutResult =
  | { status: "ignored"; reason: string }
  | { status: "duplicate" }
  | { status: "recorded"; amount: number; overpaid: number; receiptSent: boolean; excessRefunded: boolean }
  | { status: "skipped"; overpaid: number; excessRefunded: boolean };

export async function processCheckoutCompleted(
  admin: Admin,
  eventAccount: string | null,
  session: CheckoutSessionLike,
  deps: CheckoutDeps,
): Promise<CheckoutResult> {
  const paid = readPaidSession(session);
  if (!paid) return { status: "ignored", reason: "not_a_paid_invoice_session" };
  if (!eventAccount) return { status: "ignored", reason: "no_connected_account" };

  const { data: doc } = await admin
    .from("documents")
    .select(
      "id, user_id, type, status, total_amount, document_number, view_token, client:clients(name, email), payments(id, amount, source, paid_date, stripe_fee, stripe_payment_intent_id)",
    )
    .eq("id", paid.documentId)
    .maybeSingle();
  if (!doc || doc.type !== "invoice") return { status: "ignored", reason: "unknown_invoice" };

  // The event must come from the very account that belongs to this invoice's owner.
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, business_name, subscription_status")
    .eq("id", doc.user_id)
    .maybeSingle();
  if (!profile || profile.stripe_connect_account_id !== eventAccount) {
    return { status: "ignored", reason: "account_mismatch" };
  }

  const payments = (doc.payments ?? []) as {
    id?: string;
    amount: number;
    source: string;
    paid_date?: string;
    stripe_fee?: number | null;
    stripe_payment_intent_id: string | null;
  }[];
  const existingPaid = round2(payments.reduce((sum, p) => sum + p.amount, 0));
  // Only the original payment counts as "recorded": refund rows carry the payment intent too.
  const original = payments.find((p) => p.source === "stripe" && p.stripe_payment_intent_id === paid.paymentIntentId);
  // A payment already settled as pure excess (refunded, never recorded) stays that way on a replay,
  // even if the balance has changed since (e.g. the first payment was refunded meanwhile).
  const { data: settled } = original
    ? { data: null }
    : await admin
        .from("stripe_overpayments")
        .select("payment_intent_id")
        .eq("payment_intent_id", paid.paymentIntentId)
        .maybeSingle();
  const plan: StripePaymentPlan = settled
    ? { action: "skip", overpaid: paid.amount }
    : planStripePayment({
        total: doc.total_amount,
        existingPaid,
        amountPaid: paid.amount,
        alreadyRecorded: Boolean(original),
      });
  const excessInput = (recorded: number) => ({
    documentId: doc.id,
    userId: doc.user_id,
    documentNumber: doc.document_number,
    accountId: eventAccount,
    paymentIntentId: paid.paymentIntentId,
    amountPaid: paid.amount,
    amountRecorded: recorded,
    livemode: deps.livemode ?? false,
  });

  if (plan.action === "skip") {
    const settledExcess = await settleExcess(admin, excessInput(0), deps);
    return { status: "skipped", overpaid: plan.overpaid, excessRefunded: settledExcess.refunded };
  }

  let recordedAmount = 0;
  let overpaid = 0;
  let receiptSent = false;
  // The row the fee expense belongs to (set when this call records the payment).
  let feeRow: { id: string; date: string } | null = null;

  if (plan.action === "record") {
    const paymentId = globalThis.crypto.randomUUID();
    const paidDate = torontoToday(deps.now());
    const { error } = await admin.from("payments").insert({
      id: paymentId,
      document_id: doc.id,
      amount: plan.amount,
      paid_date: paidDate,
      method: "Card (online)",
      source: "stripe",
      stripe_account_id: eventAccount,
      stripe_checkout_session_id: paid.sessionId,
      stripe_payment_intent_id: paid.paymentIntentId,
    });
    // A concurrent replay lost the race on the unique index: it is a duplicate, not a failure.
    if (error && error.code !== "23505") throw new Error(error.message);
    if (error) return { status: "duplicate" };
    recordedAmount = plan.amount;
    overpaid = plan.overpaid;
    feeRow = { id: paymentId, date: paidDate };
  }

  // Status comes from the payments, exactly as the manual route does it - also on a
  // replay, so a crash between the insert and this update heals itself.
  const totalPaid = round2(existingPaid + recordedAmount);
  const { error: statusError } = await admin
    .from("documents")
    .update({ status: statusFromPaid(totalPaid, doc.total_amount), updated_at: deps.now().toISOString() })
    .eq("id", doc.id);
  if (statusError) throw new Error(statusError.message);

  if (plan.action === "duplicate") {
    // A replay: also finish a refund of the excess that did not complete the first time.
    await settleExcess(admin, excessInput(original?.amount ?? 0), deps);
    // ...and the fee expense, if the first delivery stopped before creating it (it is created once only).
    if (original?.id) {
      const date = original.paid_date ?? torontoToday(deps.now());
      if (original.stripe_fee == null) {
        // No fee stored yet (it was not attached when the payment was recorded): read it now.
        const fresh = await readFeeWithRetry(deps, paid.paymentIntentId, eventAccount, "checkout.fee-replay");
        if (fresh) await storeFeeAndRecord(admin, deps, { id: original.id, date }, doc, fresh);
      } else {
        await deps.recordFeeExpense({
          userId: doc.user_id,
          source: { kind: "payment", id: original.id },
          fee: original.stripe_fee,
          date,
          documentNumber: doc.document_number,
        });
      }
    }
    return { status: "duplicate" };
  }

  const client = doc.client as { name: string; email: string | null } | null;
  const recipient = receiptRecipient(client?.email, session.customer_details?.email);
  if (!recipient) {
    // One line, no addresses.
    console.warn(`[receipt] skipped document=${doc.id}: no email on file or entered in Checkout`);
  } else {
    receiptSent = await deps
      .sendReceipt({
        to: recipient.to,
        businessName: profile.business_name,
        clientName: client?.name ?? "there",
        documentNumber: doc.document_number,
        amountPaid: recordedAmount,
        balanceRemaining: Math.max(0, round2(doc.total_amount - totalPaid)),
        viewToken: doc.view_token,
        brandFooter: profile.subscription_status !== "pro",
      })
      .catch(() => false);
    if (!receiptSent) {
      console.warn(`[receipt] failed document=${doc.id} (sent to the ${recipient.source} email)`);
    }
  }
  // Last, so a refund that fails (thrown, retried by Stripe) never costs the client their receipt.
  const settledExcess = await settleExcess(admin, excessInput(recordedAmount), deps);
  // Stripe's fee becomes an expense (no tax), in this same delivery. The payment, status, client receipt and any
  // excess refund are already done, so waiting for Stripe to attach the fee delays nothing the client sees. A fee
  // still missing after the retries is filled in by charge.updated / a replay; a failure here throws (Stripe retries).
  if (feeRow) {
    const fee = await readFeeWithRetry(deps, paid.paymentIntentId, eventAccount, "checkout.fee-read");
    if (fee) await storeFeeAndRecord(admin, deps, feeRow, doc, fee);
  }
  return { status: "recorded", amount: recordedAmount, overpaid, receiptSent, excessRefunded: settledExcess.refunded };
}

// ------------------------------------------------------------------ charge.updated: the fee arrives

export type ChargeUpdatedResult =
  | { status: "ignored"; reason: string }
  | { status: "no_fee_yet" }
  | { status: "processed"; feeStored: boolean };

// Stripe sends charge.updated when it attaches the balance transaction. Finds OUR payment by the charge's payment
// intent (checked against the owner's connected account, like every other handler), re-reads the fee from Stripe
// by payment intent (never from the payload), stores it if the row has none, and records the fee expense - which
// is a no-op when it already exists, was deleted, or the owner's switch is off (fee_expense_outcome).
export async function processChargeUpdated(
  admin: Admin,
  eventAccount: string | null,
  chargeObject: { id?: string; object?: string; payment_intent?: string | null; metadata?: Record<string, string> | null },
  deps: Pick<CheckoutDeps, "fetchFee" | "recordFeeExpense">,
): Promise<ChargeUpdatedResult> {
  if (!eventAccount) return { status: "ignored", reason: "no_connected_account" };
  if ((chargeObject.object && chargeObject.object !== "charge") || typeof chargeObject.id !== "string") {
    return { status: "ignored", reason: "not_a_charge" };
  }
  const paymentIntentId = chargeObject.payment_intent;
  if (typeof paymentIntentId !== "string" || !paymentIntentId) return { status: "ignored", reason: "no_payment_intent" };

  const { data: payment } = await admin
    .from("payments")
    .select("id, document_id, paid_date, stripe_fee")
    .eq("source", "stripe")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (!payment) {
    const { data: over } = await admin
      .from("stripe_overpayments")
      .select("payment_intent_id")
      .eq("payment_intent_id", paymentIntentId)
      .maybeSingle();
    if (over) return { status: "ignored", reason: "payment_never_recorded" };
    // Ours but checkout.session.completed has not been processed yet: ask Stripe to deliver this again.
    if (chargeObject.metadata?.document_id) throw new RetryLater(`payment for ${paymentIntentId} is not recorded yet`);
    return { status: "ignored", reason: "not_a_taxsnap_payment" };
  }

  const { data: doc } = await admin
    .from("documents")
    .select("id, user_id, type, document_number")
    .eq("id", payment.document_id)
    .maybeSingle();
  if (!doc || doc.type !== "invoice") return { status: "ignored", reason: "unknown_invoice" };
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", doc.user_id)
    .maybeSingle();
  if (!profile || profile.stripe_connect_account_id !== eventAccount) return { status: "ignored", reason: "account_mismatch" };

  const date = payment.paid_date ?? torontoToday(new Date());
  if (payment.stripe_fee != null) {
    // Fee already stored: only make sure its expense exists (idempotent).
    await deps.recordFeeExpense({
      userId: doc.user_id,
      source: { kind: "payment", id: payment.id },
      fee: payment.stripe_fee,
      date,
      documentNumber: doc.document_number,
    });
    return { status: "processed", feeStored: false };
  }
  // One read, no retries: this event IS the signal that the fee is there. A genuine error is logged and thrown.
  let fee: StripeFee | null;
  try {
    fee = await deps.fetchFee(paymentIntentId, eventAccount);
  } catch (err) {
    logStripeError(`where=charge-updated.fee-read pi=${paymentIntentId}`, err);
    throw err;
  }
  if (!fee) return { status: "no_fee_yet" };
  await storeFeeAndRecord(admin, deps, { id: payment.id, date }, doc, fee);
  return { status: "processed", feeStored: true };
}

// ------------------------------------------------------------------ event dispatch

export interface ConnectEventLike {
  type: string;
  account?: string | null;
  /** Unix seconds when Stripe created the event. */
  created?: number;
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

export interface ConnectEventDeps extends CheckoutDeps, RefundDeps, DisputeDeps {
  retrieveAccount: (accountId: string) => Promise<AccountLike & { id: string }>;
}

// Returns a short note for stripe_events (ignored events, a refunded double
// payment); null otherwise. Throws when Stripe should deliver the event again.
export async function handleConnectEvent(
  admin: Admin,
  event: ConnectEventLike,
  deps: ConnectEventDeps,
): Promise<string | null> {
  switch (event.type) {
    case "account.updated": {
      const accountId = event.account ?? (event.data.object.id as string | undefined);
      if (!accountId) return null;
      // Re-read the account instead of trusting the (possibly out-of-order) payload.
      const fresh = await deps.retrieveAccount(accountId).catch(() => null);
      await syncConnectAccount(
        admin,
        fresh ?? { ...(event.data.object as AccountLike), id: accountId },
        deps.now(),
      );
      return null;
    }
    case "account.application.deauthorized": {
      if (event.account) await markDisconnected(admin, event.account, deps.now());
      return null;
    }
    case "checkout.session.completed": {
      const result = await processCheckoutCompleted(
        admin,
        event.account ?? null,
        event.data.object as CheckoutSessionLike,
        { ...deps, livemode: event.livemode ?? false },
      );
      if (result.status === "ignored") return `ignored:${result.reason}`;
      // An excess is always refunded automatically (a failed refund throws instead of returning).
      if (result.status === "skipped") return `overpaid:${result.overpaid.toFixed(2)}:refunded`;
      if (result.status === "recorded" && result.overpaid > 0) return `overpaid:${result.overpaid.toFixed(2)}:refunded`;
      return null;
    }
    case "charge.updated": {
      const result = await processChargeUpdated(
        admin,
        event.account ?? null,
        event.data.object as { id?: string; object?: string; payment_intent?: string | null; metadata?: Record<string, string> | null },
        deps,
      );
      if (result.status === "ignored") return `ignored:${result.reason}`;
      return null;
    }
    case "charge.refunded": {
      const result = await processChargeRefunded(
        admin,
        event.account ?? null,
        event.data.object as { id?: string; object?: string },
        deps,
      );
      if (result.status === "ignored") return `ignored:${result.reason}`;
      return result.skippedExcess > 0 ? "excess_refund_not_recorded" : null;
    }
    case "charge.dispute.created":
    case "charge.dispute.closed": {
      const result = await syncDispute(
        admin,
        event.account ?? null,
        event.data.object as { id?: string; object?: string },
        {
          eventCreated: event.created,
          livemode: event.livemode ?? false,
          notifyOnOpen: event.type === "charge.dispute.created",
        },
        deps,
      );
      if (result.status === "ignored") return `ignored:${result.reason}`;
      return null;
    }
    default:
      return null;
  }
}

// ------------------------------------------------------------------ "Pay now" rate limit

// Records this click, then says whether the token or the IP has clicked too often in
// the last few minutes. Rows older than a day are cleared as a side effect.
export async function recordCheckoutAttempt(
  admin: Admin,
  hashes: { token: string; ip: string },
  now: Date,
): Promise<{ limited: boolean }> {
  await admin.from("checkout_attempts").insert({ token_hash: hashes.token, ip_hash: hashes.ip });
  const since = new Date(now.getTime() - RATE_LIMIT.windowMinutes * 60 * 1000).toISOString();
  const [byToken, byIp] = await Promise.all([
    admin.from("checkout_attempts").select("id", { count: "exact", head: true }).eq("token_hash", hashes.token).gte("created_at", since),
    admin.from("checkout_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", hashes.ip).gte("created_at", since),
  ]);
  void admin
    .from("checkout_attempts")
    .delete()
    .lt("created_at", new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString());
  return { limited: isRateLimited({ token: byToken.count ?? 0, ip: byIp.count ?? 0 }) };
}
