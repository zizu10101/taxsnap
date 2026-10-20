import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { eventMatchesKeyMode } from "@/lib/connect-guard";
import { claimEvent, completeEvent, handleConnectEvent } from "@/lib/online-payments";
import { sendOwnerPaymentNoticeEmail, sendPaymentReceiptEmail } from "@/lib/email";
import { logStripeError, stripeErrorCode } from "@/lib/stripe-error";
import {
  createConnectExcessRefund,
  fetchPaymentFee,
  findConnectExcessRefund,
  getConnectStripe,
  listConnectRefunds,
  retrieveConnectCharge,
  retrieveConnectDispute,
} from "@/lib/stripe-connect";
import type { OwnerNotice } from "@/lib/online-refunds";

export const runtime = "nodejs";

// Events from CONNECTED ACCOUNTS (the endpoint's scope must be "Connected accounts"),
// signed with its own secret. The platform's own subscription events keep going to
// /api/stripe/webhook. Subscribed events: account.updated,
// account.application.deauthorized, checkout.session.completed, charge.refunded,
// charge.dispute.created, charge.dispute.closed.
// Runs a Stripe read/write, logging the failure (no secrets) before it propagates as a 500 + retry.
async function logged<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    logStripeError(label, err);
    throw err;
  }
}

// The owner's login email, looked up by user id; the notice itself carries no client details.
async function notifyOwner(admin: ReturnType<typeof createAdminClient>, notice: OwnerNotice): Promise<boolean> {
  const { data } = await admin.auth.admin.getUserById(notice.userId);
  const to = data.user?.email;
  if (!to) return false;
  return sendOwnerPaymentNoticeEmail({ to, notice });
}

export async function POST(request: Request) {
  const connect = getConnectStripe();
  if ("error" in connect) return NextResponse.json({ error: connect.error }, { status: 500 });
  const { stripe } = connect;

  const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "STRIPE_CONNECT_WEBHOOK_SECRET is not set" }, { status: 500 });
  }

  const body = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    // The message names what was wrong with the signature header; it never contains the secret.
    logStripeError("connect-webhook constructEvent", err);
    return NextResponse.json({ error: "Invalid signature", code: stripeErrorCode(err) }, { status: 400 });
  }

  // A test event must never touch a live ledger (and the reverse).
  if (!eventMatchesKeyMode(event.livemode, process.env.STRIPE_SECRET_KEY)) {
    return NextResponse.json({ received: true, ignored: "livemode_mismatch" });
  }

  const admin = createAdminClient();
  try {
    const claim = await claimEvent(admin, { id: event.id, type: event.type, account: event.account });
    if (claim === "duplicate") return NextResponse.json({ received: true, duplicate: true });

    const note = await handleConnectEvent(
      admin,
      { type: event.type, account: event.account ?? null, created: event.created, livemode: event.livemode, data: { object: event.data.object as unknown as Record<string, unknown> } },
      {
        now: () => new Date(),
        retrieveAccount: async (accountId) => {
          try {
            return await stripe.accounts.retrieve(accountId);
          } catch (err) {
            logStripeError("connect-webhook accounts.retrieve", err);
            throw err;
          }
        },
        fetchFee: async (paymentIntentId, accountId) => {
          try {
            return await fetchPaymentFee(stripe, paymentIntentId, accountId);
          } catch (err) {
            logStripeError("connect-webhook fetch-fee", err);
            throw err;
          }
        },
        retrieveCharge: (chargeId, accountId) =>
          logged("connect-webhook charges.retrieve", () => retrieveConnectCharge(stripe, chargeId, accountId)),
        listRefunds: (chargeId, accountId) =>
          logged("connect-webhook refunds.list", () => listConnectRefunds(stripe, chargeId, accountId)),
        retrieveDispute: (disputeId, accountId) =>
          logged("connect-webhook disputes.retrieve", () => retrieveConnectDispute(stripe, disputeId, accountId)),
        findExcessRefund: (paymentIntentId, accountId) =>
          logged("connect-webhook excess-refund lookup", () => findConnectExcessRefund(stripe, paymentIntentId, accountId)),
        refundExcess: (args) =>
          logged("connect-webhook excess refund", () => createConnectExcessRefund(stripe, args)),
        notifyOwner: (notice) => notifyOwner(admin, notice).catch(() => false),
        sendReceipt: (args) => sendPaymentReceiptEmail({ ...args, appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin }),
      },
    );
    await completeEvent(admin, event.id, note);
    return NextResponse.json({ received: true });
  } catch (err) {
    // The event stays unprocessed, so Stripe's retry will run it again.
    logStripeError(`connect-webhook ${event.type} ${event.id}`, err);
    return NextResponse.json({ error: "Processing failed", code: stripeErrorCode(err) }, { status: 500 });
  }
}
