import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { fetchStripeState, logAdminAction } from "@/lib/admin-data";
import { confirmEmailMatches, prepareAdminAction } from "@/lib/admin-route";

// Cancel the account's Stripe subscription. Deliberately does NOT touch
// profiles - Stripe is the source of truth and the existing
// customer.subscription.updated / .deleted webhook syncs the row, exactly as
// it would for a user-initiated cancel. No refund happens here; that's a
// separate, separately-confirmed action.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const prep = await prepareAdminAction(request, ctx.params);
  if (prep instanceof NextResponse) return prep;
  const { admin, profile, body, reason } = prep;

  const mode = body.mode;
  if (mode !== "period_end" && mode !== "immediate") {
    return NextResponse.json({ error: "Invalid cancel mode" }, { status: 400 });
  }
  if (!confirmEmailMatches(body, profile.email)) {
    return NextResponse.json({ error: "Confirmation email doesn't match." }, { status: 400 });
  }

  const live = await fetchStripeState(profile.stripe_customer_id, profile.stripe_subscription_id);
  if (!live?.found || !live.subscriptionId) {
    return NextResponse.json(
      { error: live?.error ?? "No Stripe subscription found for this account." },
      { status: 409 },
    );
  }
  if (["canceled", "incomplete_expired"].includes(live.status ?? "")) {
    return NextResponse.json({ error: "Subscription is already canceled." }, { status: 409 });
  }

  const stripe = getStripe();
  try {
    if (mode === "immediate") {
      await stripe.subscriptions.cancel(
        live.subscriptionId,
        { prorate: false },
        { idempotencyKey: `admin-cancel-immediate-${live.subscriptionId}` },
      );
    } else {
      if (live.cancelAtPeriodEnd) {
        return NextResponse.json(
          { error: "Subscription is already set to cancel at period end." },
          { status: 409 },
        );
      }
      await stripe.subscriptions.update(
        live.subscriptionId,
        { cancel_at_period_end: true },
        { idempotencyKey: `admin-cancel-period-end-${live.subscriptionId}` },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe cancel failed" },
      { status: 502 },
    );
  }

  const logError = await logAdminAction({
    accountId: profile.id,
    accountEmail: profile.email,
    adminId: admin.id,
    actionType: "subscription_cancel",
    oldValue: `${live.tier} (${live.status})`,
    newValue: `${mode === "immediate" ? "canceled immediately" : "cancels at period end"} · ${live.subscriptionId}`,
    reason,
  });
  if (logError) {
    return NextResponse.json(
      { error: `Subscription canceled, but writing the audit log failed: ${logError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, mode });
}
