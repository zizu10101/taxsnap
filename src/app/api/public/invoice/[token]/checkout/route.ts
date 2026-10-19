import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  CHECKOUT_EXPIRES_SECONDS,
  NOT_PAYABLE_MESSAGE,
  checkoutIdempotencyKey,
  hstPortion,
  onlinePayableAmount,
  toCents,
} from "@/lib/connect-status";
import { recordCheckoutAttempt } from "@/lib/online-payments";
import { hashForRateLimit } from "@/lib/rate-limit-hash";
import { logStripeError, stripeErrorCode } from "@/lib/stripe-error";
import { connectAppUrl, getConnectStripe } from "@/lib/stripe-connect";
import { formatDocumentNumber } from "@/lib/document-number";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

const notPayable = () => NextResponse.json({ error: NOT_PAYABLE_MESSAGE }, { status: 404 });

// Public, unauthenticated: the invoice's view token is the whole authorization (same
// boundary as /invoice/[token] itself). Nothing about the amount comes from the
// browser - the server reads the invoice and its payments, works out the balance,
// and opens a Stripe Checkout Session on the CONTRACTOR's connected account (a
// direct charge, no TaxSnap fee). An unknown token, a draft or paid invoice, an
// account that is not active and a balance of $1 or less all get the same answer.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const admin = createAdminClient();
  const now = new Date();

  // Rate limit first, before anything about the token is looked up.
  const { limited } = await recordCheckoutAttempt(
    admin,
    { token: hashForRateLimit(token), ip: hashForRateLimit(clientIp(request)) },
    now,
  );
  if (limited) {
    return NextResponse.json({ error: "Too many attempts. Please wait a few minutes." }, { status: 429 });
  }

  const { data: doc } = await admin
    .from("documents")
    .select(
      "id, user_id, type, status, document_number, total_amount, hst_amount, online_session_opened_at, client:clients(email), payments(amount)",
    )
    .eq("view_token", token)
    .eq("type", "invoice")
    .maybeSingle();
  if (!doc) return notPayable();

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_status, stripe_connect_charges_enabled, business_name")
    .eq("id", doc.user_id)
    .maybeSingle();
  if (!profile) return notPayable();

  const paid = ((doc.payments ?? []) as { amount: number }[]).reduce((sum, p) => sum + p.amount, 0);
  const amount = onlinePayableAmount({
    type: doc.type,
    status: doc.status,
    total: doc.total_amount,
    paid,
    connectStatus: profile.stripe_connect_status,
    chargesEnabled: profile.stripe_connect_charges_enabled,
    hasAccount: Boolean(profile.stripe_connect_account_id),
  });
  if (amount === null || !profile.stripe_connect_account_id) return notPayable();

  const connect = getConnectStripe();
  if ("error" in connect) {
    console.error("[checkout] connect guard:", connect.error);
    return NextResponse.json({ error: "Online payments are unavailable right now." }, { status: 503 });
  }

  const appUrl = connectAppUrl(request);
  const cents = toCents(amount);
  const label = formatDocumentNumber("invoice", doc.document_number);
  const hst = hstPortion(amount, doc.total_amount, doc.hst_amount);
  const clientEmail = (doc.client as { email: string | null } | null)?.email?.trim() || null;

  try {
    // Only the invoice number, the business name and the amount go to Stripe - nothing
    // else from the invoice. HST is already inside the amount (the invoice computed it), so
    // Stripe Tax is deliberately not used here.
    const session = await connect.stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: doc.id,
        metadata: { document_id: doc.id },
        ...(clientEmail ? { customer_email: clientEmail } : {}),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "cad",
              unit_amount: cents,
              product_data: {
                name: `Invoice ${label}`,
                description: `${profile.business_name ?? "Invoice payment"} - includes $${hst.toFixed(2)} HST`,
              },
            },
          },
        ],
        payment_intent_data: { metadata: { document_id: doc.id }, description: `Invoice ${label}` },
        expires_at: Math.floor(now.getTime() / 1000) + CHECKOUT_EXPIRES_SECONDS,
        success_url: `${appUrl}/invoice/${token}?paid=1`,
        cancel_url: `${appUrl}/invoice/${token}`,
      },
      {
        stripeAccount: profile.stripe_connect_account_id,
        idempotencyKey: checkoutIdempotencyKey(doc.id, cents, now.getTime()),
      },
    );
    if (!session.url) throw new Error("no checkout url");

    // From now on the invoice can not go back to draft (see PATCH /api/documents/[id]).
    if (!doc.online_session_opened_at) {
      await admin
        .from("documents")
        .update({ online_session_opened_at: now.toISOString() })
        .eq("id", doc.id)
        .is("online_session_opened_at", null);
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    logStripeError("public checkout create-session", err);
    return NextResponse.json(
      { error: "Could not start the payment. Please try again.", code: stripeErrorCode(err) },
      { status: 502 },
    );
  }
}
