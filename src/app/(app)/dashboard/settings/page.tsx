import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppLockSettings } from "@/components/settings/app-lock-settings";
import { RedoSetupButton } from "@/components/settings/redo-setup-button";
import { APP_SETTINGS_PUBLIC_COLUMNS } from "@/lib/app-settings-columns";

export const metadata: Metadata = {
  title: "Settings — TaxSnap",
};

// Not Pro-gated and not wrapped in DashboardHeader - same bare
// back-link-plus-content shape as /billing, since both are account-level
// pages reached via the header rather than the four-tab nav, and the app
// lock isn't a subscription-tier feature.
export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const [{ data: settings }, { data: profile }] = await Promise.all([
    supabase
      .from("app_settings")
      .select(APP_SETTINGS_PUBLIC_COLUMNS)
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("profiles").select("business_type").eq("id", user.id).single(),
  ]);

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 p-4">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage app-wide preferences.</p>
      </div>

      <div className="space-y-6">
        {/* App Lock (Owner/Staff PIN) was built for salon staff-mode - a
            general business has no staff-facing restricted view for it to
            unlock, so the whole section is hidden rather than left as a
            dead/unused setting. */}
        {profile?.business_type !== "general" && (
          <AppLockSettings
            hasOwnerPin={settings?.has_owner_pin ?? false}
            hasStaffPin={settings?.has_staff_pin ?? false}
          />
        )}
        <RedoSetupButton businessType={profile?.business_type ?? "general"} />
      </div>
    </div>
  );
}
