import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CommissionOverview } from "@/components/commission/commission-overview";
import { getCommissionOverviewData } from "@/lib/commission-overview-query";
import { getPresetRange, rangeToUtcBounds } from "@/lib/date-range";

export const metadata: Metadata = {
  title: "Register Overview — TaxSnap",
};

// All-or-nothing Pro gate, same shape as employees/page.tsx - unlike the
// other four Commission tabs (which all have real free-tier content),
// Overview is built entirely on payout/adjustment data a free or basic
// account can never have, so there's no meaningful degraded view to show
// them (no CommissionNav in the locked branch either, matching that same
// precedent - a free/basic account can't reach this tab from the nav in
// the first place, only by a direct URL/bookmark).
export default async function CommissionOverviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth");

  const { data: profile } = await supabase
    .from("profiles")
    .select("subscription_status, business_type, logo_url")
    .eq("id", user.id)
    .single();

  const isPro = profile?.subscription_status === "pro";

  // Mirrors the API route's own from/to convention (rangeToUtcBounds) so
  // this initial render and a client-side range change both hit
  // getCommissionOverviewData with identically-shaped bounds.
  const defaultRange = getPresetRange("this-month");
  const { from, to } = rangeToUtcBounds(defaultRange);
  const initialRangeData = isPro
    ? await getCommissionOverviewData(supabase, from, to)
    : null;

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
          <h1 className="text-2xl font-bold">Register Overview</h1>
          <p className="text-muted-foreground">
            Shop-wide totals across every stylist.
          </p>
        </div>

        {isPro && initialRangeData ? (
          <CommissionOverview isPro={isPro} initialRangeData={initialRangeData} />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="font-medium">Overview is a Pro feature</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Upgrade to the Pro plan ($29/mo) to see shop-wide sales,
                commission, and payout totals across every stylist.
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
