import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STRIPE_PRICE_IDS, type BillingTier } from "@/lib/stripe";
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

  const { tier } = (await request.json()) as { tier: BillingTier };

  if (tier !== "basic" && tier !== "pro") {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  if (!STRIPE_PRICE_IDS[tier]) {
    return NextResponse.json(
      { error: `Stripe price for '${tier}' is not configured` },
      { status: 500 },
    );
  }

  const url = await createCheckoutSessionUrl(supabase, user, tier, getAppUrl(request));
  return NextResponse.json({ url });
}
