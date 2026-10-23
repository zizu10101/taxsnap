import { NextResponse } from "next/server";
import { captureRouteError } from "@/lib/sentry-capture";
import { createClient } from "@/lib/supabase/server";
import { connectColumns } from "@/lib/connect-status";
import { logStripeError, stripeErrorCode } from "@/lib/stripe-error";
import { connectAppUrl, getConnectStripe } from "@/lib/stripe-connect";

// Stripe sends the owner back here after onboarding - finished OR left half way
// ("Save for later"), so this only reads the account's real state and stores it.
// The account.updated webhook keeps it current afterwards.
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

  const connect = getConnectStripe();
  if ("error" in connect) return settings("error");

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .single();
  if (!profile?.stripe_connect_account_id) return settings("error");

  try {
    const account = await connect.stripe.accounts.retrieve(profile.stripe_connect_account_id);
    const columns = connectColumns(account, new Date());
    const { error } = await supabase.from("profiles").update(columns).eq("id", user.id);
    if (error) return settings("error");
    return settings(columns.stripe_connect_status);
  } catch (err) {
    logStripeError("connect/return accounts.retrieve", err);
    await captureRouteError("/api/stripe/connect/return", err);
    return settings("error", stripeErrorCode(err));
  }
}
