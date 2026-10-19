import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { eventMatchesKeyMode } from "@/lib/connect-guard";
import { claimEvent, completeEvent, handleConnectEvent } from "@/lib/online-payments";
import { sendPaymentReceiptEmail } from "@/lib/email";
import { logStripeError, stripeErrorCode } from "@/lib/stripe-error";
import { fetchPaymentFee, getConnectStripe } from "@/lib/stripe-connect";

export const runtime = "nodejs";

// Events from CONNECTED ACCOUNTS (the endpoint's scope must be "Connected accounts"),
// signed with its own secret. The platform's own subscription events keep going to
// /api/stripe/webhook. Subscribed events: account.updated,
// account.application.deauthorized, checkout.session.completed.
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
      { type: event.type, account: event.account ?? null, data: { object: event.data.object as unknown as Record<string, unknown> } },
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
        sendReceipt: (args) => sendPaymentReceiptEmail({ ...args, appUrl: process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin }),
      },
    );
    await completeEvent(admin, event.id, note);
    if (note?.startsWith("overpaid:")) {
      // Not auto-refunded yet (later phase): leave a loud, PII-free line for a human.
      console.error(`[connect-webhook] ${note} event=${event.id} account=${event.account ?? "?"}`);
    }
    return NextResponse.json({ received: true });
  } catch (err) {
    // The event stays unprocessed, so Stripe's retry will run it again.
    logStripeError(`connect-webhook ${event.type} ${event.id}`, err);
    return NextResponse.json({ error: "Processing failed", code: stripeErrorCode(err) }, { status: 500 });
  }
}
