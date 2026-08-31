import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommissionReports } from "@/components/commission/commission-reports";
import { getPresetRange } from "@/lib/date-range";
import { STYLIST_PUBLIC_COLUMNS } from "@/lib/stylist-columns";
import type { CommissionEntryWithRelations } from "@/lib/database.types";

export const metadata: Metadata = {
  title: "Commission Reports — TaxSnap",
};

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

  const [{ data: stylists }, { data: services }, { data: entries }] = isPro
    ? await Promise.all([
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
      ])
    : [{ data: null }, { data: null }, { data: null }];

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
          <h1 className="text-2xl font-bold">Commission Reports</h1>
          <p className="text-muted-foreground">
            Per-stylist and all-stylists commission totals.
          </p>
        </div>

        {isPro ? (
          <CommissionReports
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
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="font-medium">Commission tracking is a Pro feature</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Upgrade to the Pro plan ($29/mo) to log and report per-stylist
                commissions.
              </p>
              <Button nativeButton={false} render={<Link href="/billing" />}>
                Upgrade to Pro
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
