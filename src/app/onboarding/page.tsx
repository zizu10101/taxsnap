import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { APP_SETTINGS_PUBLIC_COLUMNS } from "@/lib/app-settings-columns";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = {
  title: "Welcome to TaxSnap",
};

// Not under the (app) route group - no AppLockProvider here, deliberately.
// This flow sets up the very owner/staff PINs app-lock will later enforce,
// so it shouldn't itself be subject to that gate (mirrors /auth's own
// placement as a top-level, pre-main-app route).
//
// Both redirects below are defensive, not the primary trigger - the actual
// "send a fresh salon signup here instead of the dashboard" check lives in
// dashboard/page.tsx. This just refuses to render the flow at all for
// anyone it doesn't apply to (a general account, or someone already past
// it) if they land on /onboarding directly - a bookmark, a shared link, a
// back-button press after completing it.
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const [{ data: profile }, { data: settings }, { data: services }, { data: stylists }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("business_type, subscription_status, logo_url, onboarding_completed")
        .eq("id", user.id)
        .single(),
      supabase
        .from("app_settings")
        .select(APP_SETTINGS_PUBLIC_COLUMNS)
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase.from("services").select("*").order("name", { ascending: true }),
      supabase
        .from("stylists")
        .select(STYLIST_PUBLIC_COLUMNS)
        .order("name", { ascending: true }),
    ]);

  if (profile?.business_type !== "salon" || profile.onboarding_completed) {
    redirect("/dashboard");
  }

  return (
    <OnboardingFlow
      isPro={profile.subscription_status === "pro"}
      initialLogoPath={profile.logo_url}
      hasOwnerPin={settings?.has_owner_pin ?? false}
      hasStaffPin={settings?.has_staff_pin ?? false}
      initialServices={services ?? []}
      initialStylists={stylists ?? []}
    />
  );
}
