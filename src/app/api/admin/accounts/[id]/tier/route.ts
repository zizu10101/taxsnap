import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { hasLiveSubscription, logAdminAction } from "@/lib/admin-data";
import { prepareAdminAction } from "@/lib/admin-route";
import type { SubscriptionStatus } from "@/lib/database.types";

const TIERS: SubscriptionStatus[] = ["free", "basic", "pro"];

// Manual tier override - writes profiles.subscription_status only. Blocked
// outright for any account with a live (or unreadable) Stripe subscription:
// the next customer.subscription.* webhook would silently overwrite the
// override, so it's only meaningful for comps/test accounts. The block is
// enforced here, not just by disabling the dropdown.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const prep = await prepareAdminAction(request, ctx.params);
  if (prep instanceof NextResponse) return prep;
  const { admin, profile, body, reason } = prep;

  const tier = body.tier as SubscriptionStatus;
  if (!TIERS.includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  if (tier === profile.subscription_status) {
    return NextResponse.json({ error: "Account is already on that tier." }, { status: 400 });
  }

  if (await hasLiveSubscription(profile.stripe_customer_id, profile.stripe_subscription_id)) {
    return NextResponse.json(
      {
        error:
          "This account has a live Stripe subscription (or Stripe couldn't be checked). Overrides are blocked here - change the subscription in Stripe instead.",
      },
      { status: 409 },
    );
  }

  const { error } = await createAdminClient()
    .from("profiles")
    .update({ subscription_status: tier })
    .eq("id", profile.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const logError = await logAdminAction({
    accountId: profile.id,
    accountEmail: profile.email,
    adminId: admin.id,
    actionType: "tier_override",
    oldValue: profile.subscription_status,
    newValue: tier,
    reason,
  });
  if (logError) {
    return NextResponse.json(
      { error: `Tier changed, but writing the audit log failed: ${logError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ tier });
}
