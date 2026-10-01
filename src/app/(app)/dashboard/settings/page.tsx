import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppLockSettings } from "@/components/settings/app-lock-settings";
import { EmployeeLoginSettings } from "@/components/settings/employee-login-settings";
import { ThemeSettings } from "@/components/settings/theme-settings";
import { RedoSetupButton } from "@/components/settings/redo-setup-button";
import { ManageSubscriptionButton } from "@/components/billing/manage-subscription-button";
import { CurrentPlanCard } from "@/components/billing/current-plan-card";
import { APP_SETTINGS_PUBLIC_COLUMNS } from "@/lib/app-settings-columns";

export const metadata: Metadata = {
  title: "Settings — TaxSnap",
};

// Not Pro-gated. Reached via the top bar's Settings icon rather than the
// sidebar/bottom-nav (it has no nav item of its own - see nav-config.ts),
// since it's an account-level page like /billing, not one of the tabbed
// sections, and the app lock isn't a subscription-tier feature.
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
    supabase
      .from("profiles")
      .select(
        "business_type, subscription_status, stripe_customer_id, billing_interval, current_period_end, cancel_at_period_end, pending_tier, pending_change_effective_at",
      )
      .eq("id", user.id)
      .single(),
  ]);

  // Employee clock-in login is a general-business feature (salons use the
  // commission/register flow instead).
  const showEmployeeLogin = profile?.business_type === "general";
  const [{ data: loginSettings }, { data: employees }, { data: pins }] = showEmployeeLogin
    ? await Promise.all([
        supabase
          .from("app_settings")
          .select("employee_login_token")
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("employees")
          .select("id, name")
          .eq("is_active", true)
          .order("name", { ascending: true }),
        supabase.from("employee_pins").select("employee_id"),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  return (
    <div className="mx-auto w-full max-w-2xl">
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
        <ThemeSettings />

        <CurrentPlanCard
          tier={profile?.subscription_status ?? "free"}
          billingInterval={profile?.billing_interval ?? null}
          currentPeriodEnd={profile?.current_period_end ?? null}
          cancelAtPeriodEnd={profile?.cancel_at_period_end ?? false}
          pendingTier={profile?.pending_tier ?? null}
          pendingChangeEffectiveAt={profile?.pending_change_effective_at ?? null}
        />

        {showEmployeeLogin && (
          <EmployeeLoginSettings
            initialToken={loginSettings?.employee_login_token ?? null}
            employees={employees ?? []}
            pinEmployeeIds={(pins ?? []).map((p) => p.employee_id)}
          />
        )}

        {/* Same gate as /billing's own button (hasBillingAccount there) -
            a Stripe customer only exists once someone's actually gone
            through checkout at least once, whether or not they're
            currently on a paid tier (e.g. they downgraded back to free
            but still want their invoice history). */}
        {profile?.stripe_customer_id && <ManageSubscriptionButton />}

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
