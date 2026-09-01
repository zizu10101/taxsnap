import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { APP_SETTINGS_PUBLIC_COLUMNS } from "@/lib/app-settings-columns";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import { OnboardingFlow } from "./onboarding-flow";
import { GeneralOnboardingFlow } from "./general-onboarding-flow";

export const metadata: Metadata = {
  title: "Welcome to TaxSnap",
};

// Not under the (app) route group - no AppLockProvider here, deliberately.
// This flow sets up the very owner/staff PINs app-lock will later enforce
// (salon only), so it shouldn't itself be subject to that gate (mirrors
// /auth's own placement as a top-level, pre-main-app route).
//
// Both redirects below are defensive, not the primary trigger - the actual
// "send a fresh signup here instead of the dashboard" check lives in
// dashboard/page.tsx. This just refuses to render either flow at all for
// anyone it doesn't apply to (someone already past onboarding) if they
// land on /onboarding directly - a bookmark, a shared link, a back-button
// press after completing it.
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "business_type, subscription_status, logo_url, onboarding_completed, business_name, business_address, business_phone, business_email",
    )
    .eq("id", user.id)
    .single();

  if (!profile || profile.onboarding_completed) {
    redirect("/dashboard");
  }

  const isPro = profile.subscription_status === "pro";

  if (profile.business_type === "salon") {
    const [{ data: settings }, { data: services }, { data: stylists }] = await Promise.all([
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

    return (
      <OnboardingFlow
        isPro={isPro}
        initialLogoPath={profile.logo_url}
        hasOwnerPin={settings?.has_owner_pin ?? false}
        hasStaffPin={settings?.has_staff_pin ?? false}
        initialServices={services ?? []}
        initialStylists={stylists ?? []}
      />
    );
  }

  const { data: employees } = await supabase
    .from("employees")
    .select("*")
    .order("name", { ascending: true });

  return (
    <GeneralOnboardingFlow
      isPro={isPro}
      initialLogoPath={profile.logo_url}
      initialProfile={{
        business_name: profile.business_name,
        business_address: profile.business_address,
        business_phone: profile.business_phone,
        business_email: profile.business_email,
      }}
      initialEmployees={employees ?? []}
    />
  );
}
