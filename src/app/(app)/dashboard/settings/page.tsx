import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { AppLockSettings } from "@/components/settings/app-lock-settings";
import { EmployeeLoginSettings } from "@/components/settings/employee-login-settings";
import { ThemeSettings } from "@/components/settings/theme-settings";
import {
  BankAccountsSettings,
  ExpenseCategoriesSettings,
} from "@/components/settings/owner-lists-settings";
import { RedoSetupButton } from "@/components/settings/redo-setup-button";
import {
  NavigationSettings,
  type NavSettingsRow,
} from "@/components/settings/navigation-settings";
import {
  getNavItems,
  sanitizeHiddenNavKeys,
  type HideableNavKey,
} from "@/components/dashboard/nav-config";
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
  // commission/register flow instead). Settings only points to the Employees
  // page, where the shared link and per-employee PINs are managed.
  const showEmployeeLogin = profile?.business_type === "general";

  // Bank accounts and custom expense categories are general-business lists
  // (salons don't invoice or log trade expenses the same way). Categories
  // are Pro-only, same as Overview/Reports - the API enforces it too.
  const isGeneral = profile?.business_type === "general";
  const showCategories = isGeneral && profile?.subscription_status === "pro";
  const [{ data: bankAccounts }, { data: categories }] = isGeneral
    ? await Promise.all([
        supabase.from("bank_accounts").select("*").order("name", { ascending: true }),
        showCategories
          ? supabase.from("expense_categories").select("*").order("name", { ascending: true })
          : Promise.resolve({ data: null }),
      ])
    : [{ data: null }, { data: null }];

  // "Hide from my menu": one switch per hideable tab, with how many records sit
  // behind each so hiding one that still has data asks first. Overview and
  // Reports are views over other data and have none of their own. Salons have
  // nothing to hide (their menu is Dashboard + Register).
  const isPro = profile?.subscription_status === "pro";
  let navRows: NavSettingsRow[] = [];
  let hiddenNav: HideableNavKey[] = [];
  if (isGeneral) {
    const head = { count: "exact" as const, head: true };
    const [estimates, invoices, jobs, employees, clients, expenses, progressJobs, { data: navPrefs }] =
      await Promise.all([
        supabase.from("documents").select("id", head).eq("type", "estimate"),
        supabase.from("documents").select("id", head).eq("type", "invoice"),
        supabase.from("jobs").select("id", head),
        supabase.from("employees").select("id", head),
        supabase.from("clients").select("id", head),
        supabase.from("receipts").select("id", head),
        supabase.from("jobs").select("id", head).not("contract_value", "is", null),
        supabase.from("profiles").select("hidden_nav_keys").eq("id", user.id).maybeSingle(),
      ]);
    hiddenNav = sanitizeHiddenNavKeys(navPrefs?.hidden_nav_keys);

    const labels = new Map(
      getNavItems({ businessType: "general", isPro: true }).map((i) => [i.key, i.label]),
    );
    const defs: [HideableNavKey, number, string][] = [
      ["estimates", estimates.count ?? 0, "estimates"],
      ["invoices", invoices.count ?? 0, "invoices"],
      ["jobs", jobs.count ?? 0, "jobs"],
      ["employees", employees.count ?? 0, "employees"],
      ["clients", clients.count ?? 0, "clients"],
      ["expenses", expenses.count ?? 0, "expenses"],
      ["progress-billing", progressJobs.count ?? 0, "progress-billed jobs"],
      ["overview", 0, ""],
      ["reports", 0, ""],
    ];
    navRows = defs
      // Pro-only tabs are only listed for accounts that actually see them.
      .filter(([key]) => isPro || !["progress-billing", "overview", "reports"].includes(key))
      .map(([key, recordCount, recordNoun]) => ({
        key,
        label: labels.get(key) ?? key,
        recordCount,
        recordNoun,
      }));
  }

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

        {isGeneral && <NavigationSettings rows={navRows} initialHidden={hiddenNav} />}

        <CurrentPlanCard
          tier={profile?.subscription_status ?? "free"}
          billingInterval={profile?.billing_interval ?? null}
          currentPeriodEnd={profile?.current_period_end ?? null}
          cancelAtPeriodEnd={profile?.cancel_at_period_end ?? false}
          pendingTier={profile?.pending_tier ?? null}
          pendingChangeEffectiveAt={profile?.pending_change_effective_at ?? null}
        />

        {showEmployeeLogin && <EmployeeLoginSettings />}

        {isGeneral && <BankAccountsSettings initialAccounts={bankAccounts ?? []} />}
        {showCategories && <ExpenseCategoriesSettings initialCategories={categories ?? []} />}

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
