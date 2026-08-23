import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, STRIPE_PRICE_IDS, type BillingTier } from "@/lib/stripe";

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

  const { tier } = (await request.json()) as { tier: BillingTier };

  if (tier !== "basic" && tier !== "pro") {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  const priceId = STRIPE_PRICE_IDS[tier];
  if (!priceId) {
    return NextResponse.json(
      { error: `Stripe price for '${tier}' is not configured` },
      { status: 500 },
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  const stripe = getStripe();
  const appUrl = getAppUrl(request);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: profile?.stripe_customer_id || undefined,
    customer_email: profile?.stripe_customer_id ? undefined : user.email,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/billing?success=1`,
    cancel_url: `${appUrl}/billing?canceled=1`,
    client_reference_id: user.id,
    metadata: { user_id: user.id, tier },
    subscription_data: { metadata: { user_id: user.id, tier } },
  });

  return NextResponse.json({ url: session.url });
}
