import { NextResponse } from "next/server";
import { requireUser } from "@/lib/require-pro";
import { logStripeError, stripeErrorCode } from "@/lib/stripe-error";
import {
  isOnlinePaymentsEnabled,
  ONLINE_PAYMENTS_UNAVAILABLE_CODE,
  ONLINE_PAYMENTS_UNAVAILABLE_MESSAGE,
} from "@/lib/online-payments-config";
import { TERMS_REQUIRED_CODE, TERMS_REQUIRED_MESSAGE, termsDecision } from "@/lib/online-payments-terms";
import { connectAppUrl, createConnectedAccount, createOnboardingLink, getConnectStripe } from "@/lib/stripe-connect";

// Settings > Online payments > "Connect Stripe" / "Finish setup". Open to every plan.
// The owner must have accepted the online-payments disclosure first (the dialog sends
// `{ accept_terms: true }` the first time; the time is stored). Without it this refuses -
// before any Stripe call. Then it creates the contractor's connected account the first time
// (a fresh one if the last was disconnected) and returns a single-use Stripe-hosted
// onboarding link, which goes to the signed-in owner only and is never stored or emailed.
export async function POST(request: Request) {
  const result = await requireUser();
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const { supabase, user } = result;

  if (!isOnlinePaymentsEnabled(user.email)) {
    return NextResponse.json(
      { error: ONLINE_PAYMENTS_UNAVAILABLE_MESSAGE, code: ONLINE_PAYMENTS_UNAVAILABLE_CODE },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => null);

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_status, business_name, business_type, online_payments_terms_accepted_at")
    .eq("id", user.id)
    .single();
  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  if (profile.business_type === "salon") {
    return NextResponse.json({ error: "Online invoice payments are for general businesses." }, { status: 400 });
  }

  // The disclosure comes before anything touches Stripe.
  const decision = termsDecision({
    acceptedAt: profile.online_payments_terms_accepted_at,
    acceptTerms: body?.accept_terms,
  });
  if (decision === "required") {
    return NextResponse.json({ error: TERMS_REQUIRED_MESSAGE, code: TERMS_REQUIRED_CODE }, { status: 403 });
  }
  if (decision === "accept") {
    const { error } = await supabase
      .from("profiles")
      .update({ online_payments_terms_accepted_at: new Date().toISOString() })
      .eq("id", user.id)
      .is("online_payments_terms_accepted_at", null);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const connect = getConnectStripe();
  if ("error" in connect) return NextResponse.json({ error: connect.error }, { status: 500 });
  const { stripe } = connect;

  // Which Stripe call is running, so a failure is logged with the step that caused it.
  let step = "create-account";
  try {
    let accountId = profile.stripe_connect_account_id;
    if (!accountId || profile.stripe_connect_status === "disconnected") {
      const account = await createConnectedAccount(stripe, {
        userId: user.id,
        email: user.email ?? null,
        businessName: profile.business_name,
      });
      accountId = account.id;
      const { error } = await supabase
        .from("profiles")
        .update({
          stripe_connect_account_id: accountId,
          stripe_connect_status: "incomplete",
          stripe_connect_charges_enabled: false,
          stripe_connect_payouts_enabled: false,
        })
        .eq("id", user.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    step = "create-onboarding-link";
    const link = await createOnboardingLink(stripe, accountId, connectAppUrl(request));
    return NextResponse.json({ url: link.url });
  } catch (err) {
    logStripeError(`connect/start ${step}`, err);
    // Same generic text as always; the Stripe error CODE (no message) rides along so it shows in the Network tab.
    return NextResponse.json(
      { error: "Could not reach Stripe. Please try again.", code: stripeErrorCode(err) },
      { status: 502 },
    );
  }
}
