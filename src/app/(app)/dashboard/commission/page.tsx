import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { CommissionLogger } from "@/components/commission/commission-logger";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";

export const metadata: Metadata = {
  title: "Commission — TaxSnap",
};

// No isPro gate here anymore - logging and the edit-trail are fully
// unrestricted on every tier (see lib/free-tier-limits.ts's own scope,
// which deliberately doesn't cover commission_entries at all). The only
// place Pro actually limits anything on this page is indirectly: a free
// account only ever has up to 1 active service and 1 active stylist to
// tap through the 3-tap flow with.
export default async function CommissionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, business_type")
    .eq("id", user.id)
    .single();

  const [{ data: services }, { data: stylists }] = await Promise.all([
    supabase
      .from("services")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("stylists")
      .select(STYLIST_PUBLIC_COLUMNS)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        active="commission"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <BackToDashboardLink />

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Commission</h1>
          <p className="text-muted-foreground">
            Tap a service, then a stylist, to log a transaction.
          </p>
        </div>

        <CommissionLogger
          initialServices={services ?? []}
          initialStylists={stylists ?? []}
        />
      </main>
    </div>
  );
}
