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

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
