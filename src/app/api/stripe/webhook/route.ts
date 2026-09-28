import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { getStripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import type { BillingInterval, SubscriptionStatus } from "@/lib/database.types";

export const runtime = "nodejs";

function tierFromPriceId(priceId: string | undefined): SubscriptionStatus {
  if (priceId === STRIPE_PRICE_IDS.pro.monthly || priceId === STRIPE_PRICE_IDS.pro.yearly) {
    return "pro";
  }
  if (priceId === STRIPE_PRICE_IDS.basic.monthly || priceId === STRIPE_PRICE_IDS.basic.yearly) {
    return "basic";
  }
  return "free";
}

// Read straight off the Stripe price object's own `recurring.interval`
// rather than a second static ID-matching table - this can't drift even
// if a price is ever recreated with a new ID, unlike tierFromPriceId above
// (which has to map to a fixed tier value we invented, so it has no
// equivalent live source to read from).
function intervalFromPrice(price: Stripe.Price | undefined): BillingInterval | null {
  if (price?.recurring?.interval === "month") return "monthly";
  if (price?.recurring?.interval === "year") return "yearly";
  return null;
}

// Same static-match approach as tierFromPriceId, needed specifically for a
// Subscription Schedule's phase items - unlike a subscription's own
// items.data[0].price (expanded by Stripe into a full Price object, so
// intervalFromPrice above can read .recurring.interval straight off it), a
// schedule phase's item.price only ever comes back as a bare price ID
// string, with nothing to expand.
function intervalFromPriceId(priceId: string | undefined): BillingInterval | null {
  if (priceId === STRIPE_PRICE_IDS.basic.monthly || priceId === STRIPE_PRICE_IDS.pro.monthly) {
    return "monthly";
  }
  if (priceId === STRIPE_PRICE_IDS.basic.yearly || priceId === STRIPE_PRICE_IDS.pro.yearly) {
    return "yearly";
  }
  return null;
}

// One row per profiles column this webhook ever needs to null out for "no
// pending change" - shared by every branch that clears it (a schedule
// released/completed, or the subscription itself having no schedule at
// all) so the three fields can't drift out of sync with each other.
const NO_PENDING_CHANGE = {
  pending_tier: null,
  pending_billing_interval: null,
  pending_change_effective_at: null,
} as const;

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET is not set" },
      { status: 500 },
    );
  }

  const stripe = getStripe();
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature!, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const supabase = createAdminClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id || session.metadata?.user_id;
      if (userId && session.customer) {
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: session.customer as string })
          .eq("id", userId);
      }
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;
      const item = subscription.items.data[0];
      const isActive = ["active", "trialing"].includes(subscription.status);
      const status: SubscriptionStatus = isActive ? tierFromPriceId(item?.price?.id) : "free";

      // current_period_end lives on the subscription item, not the
      // subscription itself, in this API version (Stripe moved billing
      // periods to per-item granularity) - this app only ever creates a
      // single-item subscription, so the first item's period is the
      // subscription's period for display purposes.
      const update = {
        subscription_status: status,
        stripe_customer_id: subscription.customer as string,
        stripe_subscription_id: subscription.id,
        billing_interval: isActive ? intervalFromPrice(item?.price) : null,
        current_period_end: item
          ? new Date(item.current_period_end * 1000).toISOString()
          : null,
        cancel_at_period_end: subscription.cancel_at_period_end,
        // Only this event's own price/period fields are authoritative here.
        // Whether a change is pending lives on the attached Subscription
        // Schedule, not this object - when one's attached, leave the three
        // pending_* columns alone entirely (don't even write null) so this
        // branch can never race-clobber whatever the schedule-event branch
        // below wrote, regardless of which of the two events Stripe
        // delivers first (schedule.subscription is already non-null by the
        // time either webhook fires, so this check itself doesn't depend on
        // delivery order). No schedule attached at all -> definitely
        // nothing pending, safe to clear.
        ...(subscription.schedule ? {} : NO_PENDING_CHANGE),
      };

      if (userId) {
        await supabase.from("profiles").update(update).eq("id", userId);
      } else {
        // Fallback: match by stripe_customer_id if metadata wasn't set.
        await supabase
          .from("profiles")
          .update(update)
          .eq("stripe_customer_id", subscription.customer as string);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;

      const update = {
        subscription_status: "free" as SubscriptionStatus,
        stripe_subscription_id: null,
        billing_interval: null,
        current_period_end: null,
        cancel_at_period_end: false,
        // Covers a subscription cancelled while it still had a schedule
        // attached (e.g. a pending downgrade never got the chance to take
        // effect) - no separate subscription_schedule.canceled
        // subscription needed for this case, this event already fires.
        ...NO_PENDING_CHANGE,
      };

      if (userId) {
        await supabase.from("profiles").update(update).eq("id", userId);
      } else {
        await supabase
          .from("profiles")
          .update(update)
          .eq("stripe_customer_id", subscription.customer as string);
      }
      break;
    }

    case "subscription_schedule.created":
    case "subscription_schedule.updated": {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      const subscriptionId = schedule.subscription as string | null;
      // Phase 0 always mirrors the subscription's current price/period;
      // a second phase is the pending change a downgrade schedules. Don't
      // assume which of .created/.updated carries the two-phase state
      // first - handle both identically.
      const pendingPhase = schedule.phases.length > 1 ? schedule.phases[1] : null;
      const pendingPriceId = pendingPhase?.items[0]?.price as string | undefined;
      const pendingTier = pendingPriceId ? tierFromPriceId(pendingPriceId) : null;

      const update =
        pendingPhase && pendingTier && pendingTier !== "free"
          ? {
              pending_tier: pendingTier,
              pending_billing_interval: intervalFromPriceId(pendingPriceId),
              pending_change_effective_at: new Date(
                pendingPhase.start_date * 1000,
              ).toISOString(),
            }
          : NO_PENDING_CHANGE;

      if (subscriptionId) {
        await supabase.from("profiles").update(update).eq("stripe_subscription_id", subscriptionId);
      }
      break;
    }

    case "subscription_schedule.released":
    case "subscription_schedule.completed": {
      const schedule = event.data.object as Stripe.SubscriptionSchedule;
      // A released schedule can have `subscription: null` with the id
      // moved to `released_subscription` instead.
      const subscriptionId =
        (schedule.subscription as string | null) ?? schedule.released_subscription;

      if (subscriptionId) {
        await supabase
          .from("profiles")
          .update(NO_PENDING_CHANGE)
          .eq("stripe_subscription_id", subscriptionId);
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
