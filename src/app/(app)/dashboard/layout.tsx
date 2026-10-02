import { createClient } from "@/lib/supabase/server";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { OwnerListsProvider } from "@/components/owner-lists-provider";
import { sanitizeHiddenNavKeys } from "@/components/dashboard/nav-config";

// Mounted once around every /dashboard/** page (not /billing - that route
// lives outside this folder and keeps its own header). Replaces each page's
// own DashboardHeader render + outer wrapper markup with a single shared
// shell (sidebar desktop / bottom nav mobile - see dashboard-shell.tsx).
//
// Does its own minimal auth + profile fetch, scoped to just what the shell
// itself needs (email, business_name, subscription_status, business_type,
// logo_url). Each page underneath still does its own fuller profile query
// for its own body data (including subscription_status/business_type again
// in some cases) and its own `if (!user) redirect("/auth")` - mirroring
// (app)/layout.tsx's own pattern, a missing user here just renders children
// as-is and lets that redirect happen, rather than this layout racing it.
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return <>{children}</>;
  }

  const [
    { data: profile },
    { data: bankAccounts },
    { data: customCategories },
    { data: navPrefs },
  ] = await Promise.all([
      supabase
        .from("profiles")
        .select("business_name, subscription_status, business_type, logo_url")
        .eq("id", user.id)
        .maybeSingle(),
      supabase.from("bank_accounts").select("*").order("name", { ascending: true }),
      supabase.from("expense_categories").select("*").order("name", { ascending: true }),
      // The owner's "Hide from my menu" choices (cosmetic, 0049). A separate
      // query on purpose: if the column isn't there yet this fails alone, and
      // the profile above (business type, tier) still loads - the menu just
      // shows every tab.
      supabase.from("profiles").select("hidden_nav_keys").eq("id", user.id).maybeSingle(),
    ]);

  return (
    <DashboardShell
      email={user.email ?? ""}
      businessName={profile?.business_name ?? null}
      subscriptionStatus={profile?.subscription_status ?? "free"}
      businessType={profile?.business_type ?? "general"}
      logoPath={profile?.logo_url ?? null}
      hiddenNavKeys={sanitizeHiddenNavKeys(navPrefs?.hidden_nav_keys)}
    >
      <OwnerListsProvider
        bankAccounts={bankAccounts ?? []}
        customCategories={customCategories ?? []}
      >
        {children}
      </OwnerListsProvider>
    </DashboardShell>
  );
}
