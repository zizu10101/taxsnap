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

  try {
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
  } catch (err) {
    // Most likely cause: profile.stripe_customer_id belongs to a
    // different mode (test vs. live) than the currently-active secret
    // key - test and live customers are entirely separate objects in
    // Stripe even within the same account. Returning null instead of
    // letting this throw matters for both callers: the checkout route
    // already treats a null url as "failed to start checkout" (via the
    // client's existing !data.url check), and the auth callback already
    // falls through to a normal dashboard redirect when this comes back
    // null - neither needs its own try/catch as long as this never
    // throws past here.
    console.error("createCheckoutSessionUrl failed:", err);
    return null;
  }
}
