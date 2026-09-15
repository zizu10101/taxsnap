import Stripe from "stripe";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getStripe, STRIPE_PRICE_IDS, type BillingTier } from "@/lib/stripe";

export type CheckoutSessionResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

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
): Promise<CheckoutSessionResult> {
  const priceId = STRIPE_PRICE_IDS[tier];
  if (!priceId) {
    return { ok: false, error: `Stripe price for '${tier}' is not configured.` };
  }

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

    if (!session.url) {
      // Stripe can return a session with no url in edge cases (e.g. an
      // already-completed/expired session object) - treat that as a
      // failure too rather than letting a null slip through to a caller
      // expecting a real redirect target.
      console.error(
        `createCheckoutSessionUrl: session ${session.id} for tier '${tier}' (user ${user.id}) has no url`,
      );
      return { ok: false, error: "Stripe did not return a checkout URL." };
    }

    return { ok: true, url: session.url };
  } catch (err) {
    // Most likely cause: profile.stripe_customer_id belongs to a
    // different mode (test vs. live) than the currently-active secret
    // key - test and live customers are entirely separate objects in
    // Stripe even within the same account. A mismatched/stale price id
    // for one tier only (Stripe returns "No such price") is the other
    // real case this has actually hit in production - see the session
    // that diagnosed it.
    //
    // Logged with full structured detail (not just the generic message)
    // specifically so a future failure is traceable from Vercel Runtime
    // Logs alone, without having to reproduce it against the Stripe API
    // by hand the way this one had to be. The message (not the raw
    // Stripe error object) is also returned to the caller so it reaches
    // the client-facing toast on /billing - authenticated users only,
    // and Stripe's own error messages don't leak secrets (e.g. "No such
    // price: 'price_xxx'"), so surfacing it directly beats a generic
    // "Failed to start checkout" that requires log access to debug.
    const message = err instanceof Error ? err.message : "Unknown error";
    if (err instanceof Stripe.errors.StripeError) {
      console.error("createCheckoutSessionUrl failed:", {
        tier,
        userId: user.id,
        type: err.type,
        code: err.code,
        statusCode: err.statusCode,
        message: err.message,
      });
    } else {
      console.error("createCheckoutSessionUrl failed:", { tier, userId: user.id, err });
    }
    return { ok: false, error: message };
  }
}
