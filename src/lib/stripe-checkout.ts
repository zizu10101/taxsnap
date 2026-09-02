import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getStripe, STRIPE_PRICE_IDS, type BillingTier } from "@/lib/stripe";

// Shared between POST /api/stripe/checkout (a deliberate click on
// /billing's own Upgrade button - can fire regardless of current tier,
// e.g. Basic -> Pro) and /auth/callback (a brand-new signup's plan choice
// carried through from the landing page - see lib/auth-redirect.ts). Only
// creates the session; the "should this even happen" tier check (skip if
// the account isn't actually free) is the callback's own job, not baked
// in here, since the deliberate-upgrade caller must never be blocked by
// it.
export async function createCheckoutSessionUrl(
  supabase: SupabaseClient<Database>,
  user: User,
  tier: BillingTier,
  appUrl: string,
): Promise<string | null> {
  const priceId = STRIPE_PRICE_IDS[tier];
  if (!priceId) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  const stripe = getStripe();
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

  return session.url;
}
