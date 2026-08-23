import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/server";
import { getStripe, STRIPE_PRICE_IDS } from "@/lib/stripe";
import type { SubscriptionStatus } from "@/lib/database.types";

export const runtime = "nodejs";

function tierFromPriceId(priceId: string | undefined): SubscriptionStatus {
  if (priceId === STRIPE_PRICE_IDS.pro) return "pro";
  if (priceId === STRIPE_PRICE_IDS.basic) return "basic";
  return "free";
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
      const priceId = subscription.items.data[0]?.price?.id;
      const isActive = ["active", "trialing"].includes(subscription.status);
      const status: SubscriptionStatus = isActive
        ? tierFromPriceId(priceId)
        : "free";

      if (userId) {
        await supabase
          .from("profiles")
          .update({
            subscription_status: status,
            stripe_customer_id: subscription.customer as string,
          })
          .eq("id", userId);
      } else {
        // Fallback: match by stripe_customer_id if metadata wasn't set.
        await supabase
          .from("profiles")
          .update({ subscription_status: status })
          .eq("stripe_customer_id", subscription.customer as string);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;

      const query = supabase
        .from("profiles")
        .update({ subscription_status: "free" as SubscriptionStatus });

      if (userId) {
        await query.eq("id", userId);
      } else {
        await query.eq("stripe_customer_id", subscription.customer as string);
      }
      break;
    }

    default:
      break;
  }

  return NextResponse.json({ received: true });
}
