import { NextResponse } from "next/server";
import { captureRouteError } from "@/lib/sentry-capture";
import { createClient } from "@/lib/supabase/server";
import { isOnlinePaymentsEnabled } from "@/lib/online-payments-config";
import { logStripeError, stripeErrorCode } from "@/lib/stripe-error";
import { connectAppUrl, createOnboardingLink, getConnectStripe } from "@/lib/stripe-connect";

// Stripe sends the owner here when an onboarding link expired, was already used, or
// was opened by a link previewer. We make a fresh link with the same settings and
// send them straight on - only for the signed-in owner of that account.
export async function GET(request: Request) {
  const appUrl = connectAppUrl(request);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/auth?redirectTo=/dashboard/settings", appUrl));

  const settings = (flag: string, code?: string) =>
    NextResponse.redirect(
      new URL(`/dashboard/settings?stripe=${flag}${code ? `&code=${encodeURIComponent(code)}` : ""}`, appUrl),
    );

  if (!isOnlinePaymentsEnabled(user.email)) return settings("error");

  const connect = getConnectStripe();
  if ("error" in connect) return settings("error");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id, stripe_connect_status")
    .eq("id", user.id)
    .single();
  if (!profile?.stripe_connect_account_id || profile.stripe_connect_status === "disconnected") {
    return settings("error");
  }

  try {
    const link = await createOnboardingLink(connect.stripe, profile.stripe_connect_account_id, appUrl);
    return NextResponse.redirect(link.url);
  } catch (err) {
    logStripeError("connect/refresh create-onboarding-link", err);
    await captureRouteError("/api/stripe/connect/refresh", err);
    return settings("error", stripeErrorCode(err));
  }
}
