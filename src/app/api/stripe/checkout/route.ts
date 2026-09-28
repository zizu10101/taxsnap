import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BillingInterval, BillingTier } from "@/lib/stripe";
import { createCheckoutSessionUrl } from "@/lib/stripe-checkout";

function getAppUrl(request: Request) {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { tier, interval } = (await request.json()) as {
    tier: BillingTier;
    interval: BillingInterval;
  };

  if (tier !== "basic" && tier !== "pro") {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  if (interval !== "monthly" && interval !== "yearly") {
    return NextResponse.json({ error: "Invalid interval" }, { status: 400 });
  }

  // Re-running Checkout for an account that already has a subscription
  // doesn't modify it - Stripe creates a second, independent subscription
  // instead (confirmed against Stripe's own docs), double-billing the
  // customer. An already-paid account switching tier or interval has to go
  // through the Customer Portal instead (see /api/stripe/portal and
  // ManageSubscriptionButton) - /billing's own UI already routes those
  // clicks there rather than here, this is defense in depth for any other
  // caller of this route.
  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status")
    .eq("id", user.id)
    .single();

  if (profile && profile.subscription_status !== "free") {
    return NextResponse.json(
      {
        error:
          "You already have an active subscription - use Manage Subscription to change your plan.",
      },
      { status: 400 },
    );
  }

  // Unconfigured-price and any Stripe API failure both come back through
  // the same result shape now (see lib/stripe-checkout.ts) - no separate
  // early check needed here, so there's only one place that owns this
  // error message.
  const result = await createCheckoutSessionUrl(
    supabase,
    user,
    tier,
    interval,
    getAppUrl(request),
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ url: result.url });
}
