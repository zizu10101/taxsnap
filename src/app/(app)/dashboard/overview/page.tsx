import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { BackToDashboardLink } from "@/components/dashboard/back-to-dashboard-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ExpenseOverview } from "@/components/dashboard/expense-overview";
import { getExpenseOverviewData } from "@/lib/expense-overview-query";
import { getPresetRange } from "@/lib/date-range";

export const metadata: Metadata = {
  title: "Overview — TaxSnap",
};

// General-business analogue of dashboard/commission/overview/page.tsx -
// same all-or-nothing Pro gate shape as Jobs/Employees. A salon account
// hitting this URL directly redirects to /dashboard rather than rendering
// - this is built entirely on receipts/expense data a salon account
// already sees in its own HST summary card on the main dashboard, and the
// nav entry point (DashboardHeader) is hidden for salon in the first
// place, same precedent as Commission Overview redirecting non-salon.
export default async function ExpenseOverviewPage() {
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

  if (profile?.business_type === "salon") {
    redirect("/dashboard");
  }

  const isPro = profile?.subscription_status === "pro";

  // Plain inclusive "YYYY-MM-DD" bounds, not rangeToUtcBounds - see
  // getExpenseOverviewData's own comment. Mirrors this same preset so the
  // initial render and a client-side range change hit the query with
  // identically-shaped bounds.
  const defaultRange = getPresetRange("this-month");
  const initialRangeData = isPro
    ? await getExpenseOverviewData(supabase, defaultRange.start, defaultRange.end)
    : null;

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <DashboardHeader
        email={user.email ?? ""}
        subscriptionStatus={profile?.subscription_status ?? "free"}
        businessType={profile?.business_type ?? "general"}
        logoPath={profile?.logo_url ?? null}
        active="overview"
      />
      <main className="mx-auto w-full max-w-2xl flex-1 p-4">
        <BackToDashboardLink />

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Overview</h1>
          <p className="text-muted-foreground">
            Expense and write-off totals over time.
          </p>
        </div>

        {isPro && initialRangeData ? (
          <ExpenseOverview initialRangeData={initialRangeData} />
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Lock className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="font-medium">Overview is a Pro feature</p>
              <p className="max-w-xs text-sm text-muted-foreground">
                Upgrade to the Pro plan ($29/mo) to see expense and
                write-off totals over time.
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
