import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { fetchStripeState, getRefundable, logAdminAction } from "@/lib/admin-data";
import { confirmEmailMatches, prepareAdminAction } from "@/lib/admin-route";

// Refund (all or part of) the subscription's most recent paid invoice.
// Doesn't cancel or otherwise change the subscription.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const prep = await prepareAdminAction(request, ctx.params);
  if (prep instanceof NextResponse) return prep;
  const { admin, profile, body, reason } = prep;

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

  let refundable;
  try {
    refundable = await getRefundable(live.subscriptionId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe lookup failed" },
      { status: 502 },
    );
  }
  if (!refundable) {
    return NextResponse.json({ error: "No paid invoice to refund." }, { status: 409 });
  }

  const remaining = refundable.amountPaid - refundable.amountRefunded;
  if (remaining <= 0) {
    return NextResponse.json({ error: "That payment is already fully refunded." }, { status: 409 });
  }

  // `amount` is in dollars from the form; omitted/empty means the full
  // remaining balance.
  let cents = remaining;
  if (body.amount !== undefined && body.amount !== null && body.amount !== "") {
    const dollars = Number(body.amount);
    cents = Math.round(dollars * 100);
    if (!Number.isFinite(dollars) || cents <= 0 || cents > remaining) {
      return NextResponse.json(
        { error: `Refund amount must be between $0.01 and $${(remaining / 100).toFixed(2)}.` },
        { status: 400 },
      );
    }
  }

  let refund;
  try {
    refund = await getStripe().refunds.create(
      { payment_intent: refundable.paymentIntentId, amount: cents },
      // Keyed on the payment, what's already been refunded, and this amount:
      // a double-click repeats the same key (deduped by Stripe), while a
      // legitimate second partial refund has a different amountRefunded.
      {
        idempotencyKey: `admin-refund-${refundable.paymentIntentId}-${refundable.amountRefunded}-${cents}`,
      },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Stripe refund failed" },
      { status: 502 },
    );
  }

  const money = `${(cents / 100).toFixed(2)} ${refundable.currency.toUpperCase()}`;
  const logError = await logAdminAction({
    accountId: profile.id,
    accountEmail: profile.email,
    adminId: admin.id,
    actionType: "subscription_refund",
    oldValue: `${(refundable.amountRefunded / 100).toFixed(2)} refunded so far`,
    newValue: `refunded ${money} · ${refund.id}`,
    reason,
  });
  if (logError) {
    return NextResponse.json(
      { error: `Refund ${refund.id} issued, but writing the audit log failed: ${logError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ refundId: refund.id });
}
