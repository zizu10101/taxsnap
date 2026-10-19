import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { storedGoals } from "@/lib/onboarding";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Welcome to TaxSnap",
};

// Not under the (app) route group - no AppLockProvider here, deliberately
// (mirrors /auth's own placement as a top-level, pre-main-app route).
//
// The redirect below is defensive, not the primary trigger - the actual "send a
// fresh signup here instead of the dashboard" check lives in dashboard/page.tsx.
// This just refuses to render the flow for anyone already past onboarding (a
// bookmark, a shared link, a back-button press after completing it).
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "business_type, onboarding_completed, business_name, province, business_phone, business_address, business_number, logo_url, onboarding_goals, onboarding_goal",
    )
    .eq("id", user.id)
    .single();

  if (!profile || profile.onboarding_completed) {
    redirect("/dashboard");
  }

  return (
    <OnboardingFlow
      businessType={profile.business_type}
      initial={{
        name: profile.business_name,
        province: profile.province,
        phone: profile.business_phone,
        address: profile.business_address,
        businessNumber: profile.business_number,
        logoPath: profile.logo_url,
        goals: storedGoals(profile.onboarding_goals, profile.onboarding_goal),
      }}
    />
  );
}
