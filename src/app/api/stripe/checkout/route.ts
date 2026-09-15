import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { BillingTier } from "@/lib/stripe";
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

  // Unconfigured-price and any Stripe API failure both come back through
  // the same result shape now (see lib/stripe-checkout.ts) - no separate
  // early check needed here, so there's only one place that owns this
  // error message.
  const result = await createCheckoutSessionUrl(supabase, user, tier, getAppUrl(request));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ url: result.url });
}
