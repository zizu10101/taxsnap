import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardBody } from "@/components/dashboard/dashboard-body";

export const metadata: Metadata = {
  title: "Dashboard — TaxSnap",
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "subscription_status, business_type, logo_url, onboarding_completed, needs_business_type_prompt, business_name, business_email, business_phone, business_address",
    )
    .eq("id", user.id)
    .single();

  // Checked before the onboarding redirect below, deliberately - a
  // brand-new Google signup's business_type is still just the column
  // default ('general') until they answer this, and /onboarding itself
  // branches on business_type to pick a flow, so that branch can't fire
  // correctly until after this resolves it. Same "only place that
  // redirects here" scoping as the onboarding check.
  if (profile?.needs_business_type_prompt) {
    redirect("/auth/choose-business-type");
  }

  // Onboarding shows once for every business type, before this page ever
  // renders for real - /onboarding itself picks the salon (Logo/PINs/
  // Services/Stylists) or general-business (Logo/Business info/Staff) flow
  // from business_type. Anyone who's already finished (or skipped through)
  // it lands here normally. This is the only place that redirects to
  // /onboarding; every other /dashboard/** page is reachable directly
  // regardless (e.g. a bookmark, or a redirectTo bounce elsewhere).
  if (profile && !profile.onboarding_completed) {
    redirect("/onboarding");
  }

  const [{ data: receipts }, { data: jobs }] = await Promise.all([
    supabase
      .from("receipts")
      .select("*")
      .order("transaction_date", { ascending: false }),
    // Job names for the receipt job picker - not Pro-gated (job tagging on
    // receipts is available on every tier), so this reads the jobs table
    // directly rather than going through the Pro-only /api/jobs route.
    supabase.from("jobs").select("name").order("name", { ascending: true }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
      />
      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 p-4">
        <DashboardBody
          initialReceipts={receipts ?? []}
          initialJobNames={(jobs ?? []).map((j) => j.name)}
          businessType={profile?.business_type ?? "general"}
          subscriptionStatus={profile?.subscription_status ?? "free"}
          business={{
            name: profile?.business_name ?? null,
            email: profile?.business_email || user.email || "",
            phone: profile?.business_phone ?? null,
            address: profile?.business_address ?? null,
          }}
          logoPath={profile?.logo_url ?? null}
        />
      </main>
    </div>
  );
}
