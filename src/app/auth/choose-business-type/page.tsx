import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { PENDING_BUSINESS_TYPE_COOKIE, sanitizePendingBusinessType } from "@/lib/auth-redirect";
import { ChooseBusinessTypeForm } from "./choose-business-type-form";

export const metadata: Metadata = {
  title: "Welcome to TaxSnap",
};

// Not under (app) - reached right after a Google OAuth callback, before
// the account is fully "in" the app, same placement rationale as /auth and
// /onboarding. Only ever shown once: needs_business_type_prompt is cleared
// the moment ChooseBusinessTypeForm's submit succeeds (see
// /api/profile/business-type), so a returning Google user's later sign-ins
// never redirect here again. The redirect is defensive here too - the real
// trigger is dashboard/page.tsx's own check, this just refuses to render
// for anyone who's already answered (or was never asked) if they land on
// this URL directly.
export default async function ChooseBusinessTypePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("needs_business_type_prompt")
    .eq("id", user.id)
    .single();

  if (!profile?.needs_business_type_prompt) {
    redirect("/dashboard");
  }

  // Set by a "Get Started" click on /salons (?business=salon) before the
  // Google redirect - Google's own handshake can't carry custom signup
  // data the way signUp()/signInWithOtp()'s `data` option can, so this
  // cookie is what survives the round trip to pre-select the toggle below
  // instead of defaulting to General. Still fully changeable, same as
  // every other business_type entry point.
  const cookieStore = await cookies();
  const defaultBusinessType = sanitizePendingBusinessType(
    cookieStore.get(PENDING_BUSINESS_TYPE_COOKIE)?.value,
  );

  return <ChooseBusinessTypeForm defaultBusinessType={defaultBusinessType ?? "general"} />;
}
