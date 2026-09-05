import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { CommissionReports } from "@/components/commission/commission-reports";
import { getPresetRange } from "@/lib/date-range";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import type { CommissionEntryWithRelations } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Register Reports — TaxSnap",
};

// No isPro gate here anymore - a free-tier salon account gets a real,
// functional (if capped) Reports view: totals and the itemized list for
// whatever they've actually logged against their 1 free service/stylist.
// isPro is passed down so CommissionReports can lock just the parts that
// stay Pro-only - PDF export/Share, and payouts (see that component's own
// comment for why those specifically aren't touched here).
export default async function CommissionReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "subscription_status, business_type, logo_url, business_name, business_address, business_phone, business_email",
    )
    .eq("id", user.id)
    .single();

  const isPro = profile?.subscription_status === "pro";

  const defaultRange = getPresetRange("this-month");

  const [{ data: stylists }, { data: services }, { data: entries }] = await Promise.all([
    supabase.from("stylists").select(STYLIST_PUBLIC_COLUMNS).order("name", { ascending: true }),
    // Needed for EditEntryDialog's service picker - the report itself
    // never rendered services before edit capability was added here.
    supabase
      .from("services")
      .select("*")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("commission_entries")
      .select(
        `*, stylist:stylists!commission_entries_stylist_id_fkey(${STYLIST_PUBLIC_COLUMNS}), service:services!commission_entries_service_id_fkey(*), payout:payouts(id, confirmed_by_stylist, confirmed_at, paid_at, status, total_amount, range_start, range_end)`,
      )
      .gte("created_at", defaultRange.start ?? "1970-01-01")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="commission"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <BackToDashboardLink />

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Register Reports</h1>
          <p className="text-muted-foreground">
            Per-stylist and all-stylists commission totals.
          </p>
        </div>

        <CommissionReports
          isPro={isPro}
          stylists={stylists ?? []}
          services={services ?? []}
          initialEntries={(entries ?? []) as CommissionEntryWithRelations[]}
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
